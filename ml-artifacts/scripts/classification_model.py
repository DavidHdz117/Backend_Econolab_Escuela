"""Train and use the ECONOLAB service outcome classifier in Python.

This script supports two commands:

- `train` (default): reads the canonical CSV, trains the classifier, exports
  `.pkl` and `.json` artifacts, and regenerates the evidence CSV/report files.
- `predict`: reads JSON from stdin and returns predictions using the exported
  `.pkl` model.
"""

from __future__ import annotations

import hashlib
import json
import os
import pickle
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

SERVICE_OUTCOME_CLASSES = [
    "completed_on_time",
    "delayed",
    "cancelled",
]
SERVICE_OUTCOME_MODEL_VERSION = "3.0.0"
SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS = 5
SERVICE_OUTCOME_TEST_FRACTION = 0.20
RANDOM_SEED = 42

NUMERIC_FEATURE_COLUMNS = [
    "promised_lead_hours",
    "registration_hour",
    "registration_weekday",
    "item_count",
    "total_quantity",
    "distinct_study_count",
    "package_component_count",
    "subtotal_amount",
    "courtesy_percent",
    "discount_amount",
    "total_amount",
]
CATEGORICAL_FEATURE_COLUMNS = [
    "branch_name",
    "dominant_price_type",
]

CANONICAL_HEADERS = [
    "order_id",
    "source_folio",
    "is_synthetic",
    "source_created_at",
    "source_updated_at",
    *NUMERIC_FEATURE_COLUMNS,
    *CATEGORICAL_FEATURE_COLUMNS,
    "outcome",
]


@dataclass
class PreparedDataset:
    rows: pd.DataFrame
    discarded_rows: int
    feature_columns: list[str]
    numeric_features: list[str]
    categorical_features: list[str]
    class_distribution: dict[str, int]
    warnings: list[str]


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def round4(value: float) -> float:
    return round(float(value), 4)


def normalize_category(value: object, fallback: str = "__missing__") -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return fallback
    text = str(value).strip().lower()
    text = "".join(
        character
        for character in unicodedata.normalize("NFD", text)
        if unicodedata.category(character) != "Mn"
    )
    text = " ".join(text.split())
    return text or fallback


def to_iso_timestamp(value: object) -> str | None:
    if value is None:
        return None
    try:
        timestamp = pd.Timestamp(str(value), tz="UTC")
    except Exception:
        return None
    if pd.isna(timestamp):
        return None
    return timestamp.isoformat()


def to_number_or_nan(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes", "si"}


def read_json_stdin() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def resolve_pickle_path(root: Path, requested: str | None = None) -> Path:
    if requested:
        candidate = Path(requested)
        return candidate if candidate.is_absolute() else root / candidate

    configured_path = os.environ.get("SERVICE_OUTCOME_MODEL_PKL_PATH", "").strip()
    if configured_path:
        candidate = Path(configured_path)
        return candidate if candidate.is_absolute() else root / candidate

    candidates = [
        root / "07_Modelos" / "classification_service_outcome_model.pkl",
        root
        / "ml"
        / "classification"
        / "artifacts"
        / "classification_service_outcome_model.pkl",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def load_and_prepare_dataset(root: Path) -> PreparedDataset:
    dataset_path = root / "05_Datasets" / "03_clasificacion_resultado_servicios.csv"
    raw = pd.read_csv(dataset_path)

    missing = sorted(set(CANONICAL_HEADERS).difference(raw.columns))
    if missing:
        raise ValueError(f"Missing columns in classification CSV: {', '.join(missing)}")

    rows = raw.copy()
    initial_count = len(rows)
    rows["order_id"] = to_number_or_nan(rows["order_id"]).astype("Int64")
    rows["source_created_at"] = rows["source_created_at"].map(to_iso_timestamp)
    rows["source_updated_at"] = rows["source_updated_at"].map(to_iso_timestamp)
    rows["is_synthetic"] = rows["is_synthetic"].map(truthy)
    rows["outcome"] = rows["outcome"].astype(str).str.strip()

    for column in NUMERIC_FEATURE_COLUMNS:
        rows[column] = to_number_or_nan(rows[column])
    for column in CATEGORICAL_FEATURE_COLUMNS:
        rows[column] = rows[column].map(lambda value: normalize_category(value))

    rows = rows.dropna(subset=["order_id"])
    rows = rows[rows["order_id"] > 0].copy()
    rows = rows.drop_duplicates(subset=["order_id"], keep="first")
    rows = rows[rows["source_created_at"].notna()].copy()
    rows = rows[rows["outcome"].isin(SERVICE_OUTCOME_CLASSES)].copy()
    rows = rows[
        rows["promised_lead_hours"].notna() & (rows["promised_lead_hours"] > 0)
    ].copy()
    rows = rows[rows["item_count"].notna() & (rows["item_count"] > 0)].copy()
    rows = rows[
        rows["total_quantity"].notna() & (rows["total_quantity"] >= rows["item_count"])
    ].copy()
    rows = rows[
        rows["distinct_study_count"].notna() & (rows["distinct_study_count"] > 0)
    ].copy()
    rows = rows[
        rows["package_component_count"].notna() & (rows["package_component_count"] >= 0)
    ].copy()
    rows = rows[
        rows["subtotal_amount"].notna() & (rows["subtotal_amount"] >= 0)
    ].copy()
    rows = rows[
        rows["courtesy_percent"].notna()
        & (rows["courtesy_percent"] >= 0)
        & (rows["courtesy_percent"] <= 100)
    ].copy()
    rows = rows[
        rows["discount_amount"].notna()
        & (rows["discount_amount"] >= 0)
        & (rows["discount_amount"] <= rows["subtotal_amount"])
    ].copy()
    rows = rows[
        rows["total_amount"].notna() & (rows["total_amount"] >= 0)
    ].copy()
    rows = rows[
        (rows["total_amount"] - (rows["subtotal_amount"] - rows["discount_amount"])).abs()
        <= 0.02
    ].copy()

    warnings: list[str] = []
    numeric_features: list[str] = []
    categorical_features: list[str] = []
    omitted_features: list[str] = []

    for column in NUMERIC_FEATURE_COLUMNS:
        values = rows[column].dropna().tolist()
        if len(values) < 2:
            omitted_features.append(column)
            continue
        frequencies = pd.Series(values).value_counts(normalize=True)
        dominant = float(frequencies.iloc[0]) if not frequencies.empty else 1.0
        deviation = float(np.std(values))
        if dominant >= 0.99 or deviation <= 1e-9:
            omitted_features.append(column)
            continue
        numeric_features.append(column)

    for column in CATEGORICAL_FEATURE_COLUMNS:
        values = rows[column].dropna().astype(str)
        if values.empty:
            omitted_features.append(column)
            continue
        frequencies = values.value_counts(normalize=True)
        dominant = float(frequencies.iloc[0]) if not frequencies.empty else 1.0
        if values.nunique() < 2 or dominant >= 0.99:
            omitted_features.append(column)
            continue
        categorical_features.append(column)

    feature_columns = [*numeric_features, *categorical_features]
    if not feature_columns:
        raise ValueError("The classification dataset has no usable predictor columns.")

    if omitted_features:
        warnings.append(
            "Las variables vacias, constantes o con al menos 99 % del mismo valor fueron omitidas del modelo."
        )

    class_distribution = {
        outcome: int((rows["outcome"] == outcome).sum()) for outcome in SERVICE_OUTCOME_CLASSES
    }
    missing_class = next(
        (
            outcome
            for outcome, count in class_distribution.items()
            if count < SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS
        ),
        None,
    )
    if missing_class:
        raise ValueError(
            f"At least {SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS} rows per class are required."
        )

    rows = rows.sort_values(["source_created_at", "order_id"]).reset_index(drop=True)
    discarded_rows = initial_count - len(rows)
    return PreparedDataset(
        rows=rows,
        discarded_rows=discarded_rows,
        feature_columns=feature_columns,
        numeric_features=numeric_features,
        categorical_features=categorical_features,
        class_distribution=class_distribution,
        warnings=warnings,
    )


def temporal_split(rows: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    test_size = max(1, min(len(rows) - 1, round(len(rows) * SERVICE_OUTCOME_TEST_FRACTION)))
    train = rows.iloc[: len(rows) - test_size].copy()
    test = rows.iloc[len(rows) - test_size :].copy()
    for outcome in SERVICE_OUTCOME_CLASSES:
        if int((train["outcome"] == outcome).sum()) == 0 or int((test["outcome"] == outcome).sum()) == 0:
            raise ValueError(
                f"The temporal holdout does not preserve examples of {outcome} in train and test."
            )
    return train.reset_index(drop=True), test.reset_index(drop=True)


def temporal_period(rows: pd.DataFrame) -> dict[str, str]:
    ordered = rows["source_created_at"].dropna().astype(str).sort_values().tolist()
    if not ordered:
        raise ValueError("There are no valid timestamps for the classification period.")
    return {"start": ordered[0], "end": ordered[-1]}


def class_weights_from_rows(rows: pd.DataFrame) -> dict[str, float]:
    total = len(rows)
    class_count = len(SERVICE_OUTCOME_CLASSES)
    distribution = rows["outcome"].value_counts().to_dict()
    return {
        outcome: round4(total / (class_count * int(distribution[outcome])))
        for outcome in SERVICE_OUTCOME_CLASSES
    }


def build_pipeline(
    numeric_features: list[str],
    categorical_features: list[str],
    class_weights: dict[str, float],
) -> Pipeline:
    transformers: list[tuple[str, Any, list[str]]] = []
    if numeric_features:
        transformers.append(
            (
                "numeric",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_features,
            )
        )
    if categorical_features:
        transformers.append(
            (
                "categorical",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "onehot",
                            OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                        ),
                    ]
                ),
                categorical_features,
            )
        )

    preprocessor = ColumnTransformer(transformers=transformers, remainder="drop")
    classifier = LogisticRegression(
        max_iter=3_000,
        class_weight=class_weights,
        random_state=RANDOM_SEED,
        solver="lbfgs",
    )
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("classifier", classifier),
        ]
    )


def evaluate_predictions(actual: list[str], predicted: list[str]) -> dict[str, Any]:
    labels = SERVICE_OUTCOME_CLASSES
    matrix = confusion_matrix(actual, predicted, labels=labels)
    precision, recall, f1, support = precision_recall_fscore_support(
        actual,
        predicted,
        labels=labels,
        zero_division=0,
    )
    accuracy = accuracy_score(actual, predicted)

    metrics_by_class = {
        outcome: {
            "precision": round4(precision[index]),
            "recall": round4(recall[index]),
            "f1Score": round4(f1[index]),
            "support": int(support[index]),
        }
        for index, outcome in enumerate(labels)
    }

    macro_precision, macro_recall, macro_f1, _ = precision_recall_fscore_support(
        actual,
        predicted,
        labels=labels,
        average="macro",
        zero_division=0,
    )
    weighted_precision, weighted_recall, weighted_f1, _ = precision_recall_fscore_support(
        actual,
        predicted,
        labels=labels,
        average="weighted",
        zero_division=0,
    )

    return {
        "accuracy": round4(accuracy),
        "confusionMatrix": {
            actual_label: {
                predicted_label: int(matrix[row_index][column_index])
                for column_index, predicted_label in enumerate(labels)
            }
            for row_index, actual_label in enumerate(labels)
        },
        "metricsByClass": metrics_by_class,
        "macroAverage": {
            "precision": round4(macro_precision),
            "recall": round4(macro_recall),
            "f1Score": round4(macro_f1),
        },
        "weightedAverage": {
            "precision": round4(weighted_precision),
            "recall": round4(weighted_recall),
            "f1Score": round4(weighted_f1),
        },
    }


def build_artifact(
    prepared: PreparedDataset,
    train_rows: pd.DataFrame,
    test_rows: pd.DataFrame,
    pipeline: Pipeline,
    dataset_sha256: str,
    source_watermark: str,
) -> dict[str, Any]:
    classifier: LogisticRegression = pipeline.named_steps["classifier"]
    preprocessor: ColumnTransformer = pipeline.named_steps["preprocessor"]
    numeric_transformer = preprocessor.named_transformers_.get("numeric")
    categorical_transformer = preprocessor.named_transformers_.get("categorical")

    training_distribution = {
        outcome: int((train_rows["outcome"] == outcome).sum()) for outcome in SERVICE_OUTCOME_CLASSES
    }
    test_distribution = {
        outcome: int((test_rows["outcome"] == outcome).sum()) for outcome in SERVICE_OUTCOME_CLASSES
    }
    class_weights = class_weights_from_rows(train_rows)

    test_predictions = pipeline.predict(test_rows[prepared.feature_columns]).tolist()
    evaluation = evaluate_predictions(test_rows["outcome"].tolist(), test_predictions)
    majority_class = max(training_distribution, key=training_distribution.get)
    baseline = [majority_class] * len(test_rows)
    baseline_evaluation = evaluate_predictions(test_rows["outcome"].tolist(), baseline)

    preprocessing_numeric: list[dict[str, Any]] = []
    preprocessing_categorical: list[dict[str, Any]] = []

    ordered_feature_count = 1
    if prepared.numeric_features and numeric_transformer is not None:
        imputer: SimpleImputer = numeric_transformer.named_steps["imputer"]
        scaler: StandardScaler = numeric_transformer.named_steps["scaler"]
        for index, key in enumerate(prepared.numeric_features):
            preprocessing_numeric.append(
                {
                    "key": key.replace("_", "").replace("hours", "Hours")
                    if False
                    else snake_to_camel(key),
                    "mean": round4(float(scaler.mean_[index])),
                    "standardDeviation": round4(float(scaler.scale_[index])),
                }
            )
        ordered_feature_count += len(prepared.numeric_features)

    categorical_feature_names = []
    if prepared.categorical_features and categorical_transformer is not None:
        onehot: OneHotEncoder = categorical_transformer.named_steps["onehot"]
        for index, key in enumerate(prepared.categorical_features):
            categories = [str(value) for value in onehot.categories_[index].tolist()]
            preprocessing_categorical.append(
                {
                    "key": snake_to_camel(key),
                    "categories": categories,
                }
            )
            ordered_feature_count += len(categories)
            categorical_feature_names.extend(categories)

    weights = [
        [round4(float(classifier.intercept_[class_index]))]
        + [round4(float(value)) for value in classifier.coef_[class_index].tolist()]
        for class_index in range(len(SERVICE_OUTCOME_CLASSES))
    ]

    artifact = {
        "artifactType": "econolab_service_outcome_classifier",
        "schemaVersion": 2,
        "trainedAt": source_watermark,
        "datasetSha256": dataset_sha256,
        "sourceWatermark": source_watermark,
        "model": {
            "algorithm": "multinomial_logistic_regression",
            "version": SERVICE_OUTCOME_MODEL_VERSION,
            "classes": SERVICE_OUTCOME_CLASSES,
            "validationStrategy": "temporal_holdout",
            "orderingField": "source_created_at",
            "testFraction": SERVICE_OUTCOME_TEST_FRACTION,
            "classBalanceStrategy": "inverse_frequency_class_weights",
        },
        "dataset": {
            "eligibleSamples": int(len(prepared.rows)),
            "trainingSamples": int(len(train_rows)),
            "evaluationTrainingSamples": int(len(train_rows)),
            "evaluationTestSamples": int(len(test_rows)),
            "minimumSamplesPerClass": SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
            "discardedRows": int(prepared.discarded_rows),
            "classDistribution": prepared.class_distribution,
            "classWeights": class_weights,
            "trainingClassDistribution": training_distribution,
            "testClassDistribution": test_distribution,
            "eligiblePeriod": temporal_period(prepared.rows),
            "trainingPeriod": temporal_period(train_rows),
            "testPeriod": temporal_period(test_rows),
            "predictorsX": [snake_to_camel(column) for column in prepared.feature_columns],
            "targetY": "outcome",
        },
        "evaluation": {
            **evaluation,
            "baseline": {
                "strategy": "majority_class",
                "predictedClass": majority_class,
                **baseline_evaluation,
            },
        },
        "preprocessing": {
            "numeric": preprocessing_numeric,
            "categorical": preprocessing_categorical,
        },
        "classifier": {"weights": weights},
        "warnings": [
            *prepared.warnings,
            *(
                [f"Se descartaron {prepared.discarded_rows} filas no utilizables."]
                if prepared.discarded_rows > 0
                else []
            ),
            *(
                [
                    "Las clases estan desbalanceadas; se aplicaron pesos inversos y deben revisarse las metricas por clase."
                ]
                if max(prepared.class_distribution.values())
                >= min(prepared.class_distribution.values()) * 2
                else []
            ),
        ],
    }

    expected_weight_length = 1
    expected_weight_length += len(prepared.numeric_features)
    for item in preprocessing_categorical:
        expected_weight_length += len(item["categories"])
    for row in artifact["classifier"]["weights"]:
        if len(row) != expected_weight_length:
            raise ValueError("The generated classification artifact has invalid weights.")
    return artifact


def snake_to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(item.capitalize() for item in tail)


def camel_to_snake(value: str) -> str:
    characters = []
    for character in value:
        if character.isupper():
            characters.append("_")
            characters.append(character.lower())
        else:
            characters.append(character)
    return "".join(characters).lstrip("_")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_pickle(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handler:
        pickle.dump(value, handler)


def build_feature_report(rows: pd.DataFrame, feature_columns: list[str]) -> dict[str, Any]:
    report: dict[str, Any] = {"numeric": {}, "categorical": {}}
    for column in feature_columns:
        if column in NUMERIC_FEATURE_COLUMNS:
            values = pd.to_numeric(rows[column], errors="coerce").dropna()
            report["numeric"][column] = {
                "nonNullCount": int(values.count()),
                "nullCount": int(len(rows) - values.count()),
                "minimum": round4(float(values.min())) if not values.empty else None,
                "maximum": round4(float(values.max())) if not values.empty else None,
                "mean": round4(float(values.mean())) if not values.empty else None,
                "standardDeviation": round4(float(values.std(ddof=0))) if not values.empty else None,
            }
        else:
            values = rows[column].astype(str).fillna("__missing__")
            report["categorical"][column] = {
                "nullCount": int((values == "__missing__").sum()),
                "cardinality": int(values.nunique()),
                "mostFrequent": values.value_counts().head(10).to_dict(),
            }
    return report


def train_and_export(root: Path | None = None) -> dict[str, Any]:
    root = root or project_root()
    prepared = load_and_prepare_dataset(root)
    train_rows, test_rows = temporal_split(prepared.rows)
    class_weights = class_weights_from_rows(train_rows)
    pipeline = build_pipeline(
        prepared.numeric_features,
        prepared.categorical_features,
        class_weights,
    )
    pipeline.fit(train_rows[prepared.feature_columns], train_rows["outcome"])

    canonical_rows = prepared.rows[CANONICAL_HEADERS].copy()
    canonical_rows["is_synthetic"] = canonical_rows["is_synthetic"].map(
        lambda value: "true" if bool(value) else "false"
    )
    canonical_csv = canonical_rows.to_csv(index=False)
    dataset_sha256 = hashlib.sha256(canonical_csv.encode("utf-8")).hexdigest()
    source_watermark = (
        prepared.rows["source_updated_at"].dropna().astype(str).sort_values().iloc[-1]
    )
    artifact = build_artifact(
        prepared,
        train_rows,
        test_rows,
        pipeline,
        dataset_sha256,
        source_watermark,
    )

    model_bundle = {
        "pipeline": pipeline,
        "feature_columns": prepared.feature_columns,
        "numeric_features": prepared.numeric_features,
        "categorical_features": prepared.categorical_features,
        "classes": SERVICE_OUTCOME_CLASSES,
        "artifact_version": SERVICE_OUTCOME_MODEL_VERSION,
    }

    backend_dataset = root / "05_Datasets"
    backend_models = root / "07_Modelos"
    ml_root = root / "ml" / "classification"

    dataset_path = backend_dataset / "03_clasificacion_resultado_servicios.csv"
    train_csv_path = backend_dataset / "03_clasificacion_resultado_servicios_train.csv"
    test_csv_path = backend_dataset / "03_clasificacion_resultado_servicios_test.csv"
    predictions_path = (
        backend_dataset / "03_clasificacion_resultado_servicios_predicciones_test.csv"
    )
    artifact_json_path = backend_models / "classification_service_outcome_model.json"
    artifact_pickle_path = backend_models / "classification_service_outcome_model.pkl"
    report_path = backend_models / "classification_training_report.json"
    model_card_path = backend_models / "classification_model_card.md"

    ml_dataset_path = ml_root / "data" / "classification_service_outcomes.csv"
    ml_train_csv_path = ml_root / "data" / "classification_service_outcomes_train.csv"
    ml_test_csv_path = ml_root / "data" / "classification_service_outcomes_test.csv"
    ml_predictions_path = (
        ml_root / "reports" / "classification_service_outcomes_test_predictions.csv"
    )
    ml_artifact_json_path = (
        ml_root / "artifacts" / "classification_service_outcome_model.json"
    )
    ml_artifact_pickle_path = (
        ml_root / "artifacts" / "classification_service_outcome_model.pkl"
    )
    ml_report_path = ml_root / "reports" / "classification_training_report.json"

    dataset_path.parent.mkdir(parents=True, exist_ok=True)
    backend_models.mkdir(parents=True, exist_ok=True)
    (ml_root / "data").mkdir(parents=True, exist_ok=True)
    (ml_root / "artifacts").mkdir(parents=True, exist_ok=True)
    (ml_root / "reports").mkdir(parents=True, exist_ok=True)

    canonical_rows.to_csv(dataset_path, index=False)
    canonical_rows.to_csv(ml_dataset_path, index=False)
    train_rows[CANONICAL_HEADERS].assign(
        is_synthetic=lambda frame: frame["is_synthetic"].map(lambda value: "true" if bool(value) else "false")
    ).to_csv(train_csv_path, index=False)
    train_rows[CANONICAL_HEADERS].assign(
        is_synthetic=lambda frame: frame["is_synthetic"].map(lambda value: "true" if bool(value) else "false")
    ).to_csv(ml_train_csv_path, index=False)
    test_rows[CANONICAL_HEADERS].assign(
        is_synthetic=lambda frame: frame["is_synthetic"].map(lambda value: "true" if bool(value) else "false")
    ).to_csv(test_csv_path, index=False)
    test_rows[CANONICAL_HEADERS].assign(
        is_synthetic=lambda frame: frame["is_synthetic"].map(lambda value: "true" if bool(value) else "false")
    ).to_csv(ml_test_csv_path, index=False)

    probabilities = pipeline.predict_proba(test_rows[prepared.feature_columns])
    predicted = pipeline.predict(test_rows[prepared.feature_columns]).tolist()
    prediction_rows = []
    for row_index, (_, row) in enumerate(test_rows.iterrows()):
        prediction_rows.append(
            {
                "order_id": int(row["order_id"]),
                "source_folio": row["source_folio"],
                "is_synthetic": "true" if bool(row["is_synthetic"]) else "false",
                "source_created_at": row["source_created_at"],
                "actual_outcome": row["outcome"],
                "predicted_outcome": predicted[row_index],
                "confidence": round4(float(np.max(probabilities[row_index]))),
                "probability_completed_on_time": round4(
                    float(probabilities[row_index][SERVICE_OUTCOME_CLASSES.index("completed_on_time")])
                ),
                "probability_delayed": round4(
                    float(probabilities[row_index][SERVICE_OUTCOME_CLASSES.index("delayed")])
                ),
                "probability_cancelled": round4(
                    float(probabilities[row_index][SERVICE_OUTCOME_CLASSES.index("cancelled")])
                ),
            }
        )
    pd.DataFrame(prediction_rows).to_csv(predictions_path, index=False)
    pd.DataFrame(prediction_rows).to_csv(ml_predictions_path, index=False)

    synthetic_rows = int(prepared.rows["is_synthetic"].sum())
    report = {
        "reportType": "econolab_classification_training_report",
        "generatedFromSourceWatermark": source_watermark,
        "sourceQuery": "05_Datasets/03_clasificacion_resultado_servicios.csv",
        "datasetCsv": "ml/classification/data/classification_service_outcomes.csv",
        "modelArtifact": "ml/classification/artifacts/classification_service_outcome_model.json",
        "pickleArtifact": "ml/classification/artifacts/classification_service_outcome_model.pkl",
        "datasetSha256": dataset_sha256,
        "evaluationSplit": {
            "strategy": artifact["model"]["validationStrategy"],
            "orderingField": artifact["model"]["orderingField"],
            "chronological": True,
            "requestedTestFraction": artifact["model"]["testFraction"],
            "trainingCsv": "05_Datasets/03_clasificacion_resultado_servicios_train.csv",
            "testCsv": "05_Datasets/03_clasificacion_resultado_servicios_test.csv",
            "trainingRows": int(len(train_rows)),
            "testRows": int(len(test_rows)),
            "eligiblePeriod": artifact["dataset"]["eligiblePeriod"],
            "trainingPeriod": artifact["dataset"]["trainingPeriod"],
            "testPeriod": artifact["dataset"]["testPeriod"],
            "trainingClassDistribution": artifact["dataset"]["trainingClassDistribution"],
            "testClassDistribution": artifact["dataset"]["testClassDistribution"],
            "trainEndsBeforeTestStarts": artifact["dataset"]["trainingPeriod"]["end"]
            <= artifact["dataset"]["testPeriod"]["start"],
            "overlapCount": 0,
        },
        "traceability": {
            "rowUnit": "una orden de servicio historica",
            "predictorsX": artifact["dataset"]["predictorsX"],
            "targetY": artifact["dataset"]["targetY"],
            "auditOnlyNotUsedAsX": [
                "order_id",
                "source_folio",
                "source_created_at",
                "source_updated_at",
                "is_synthetic",
            ],
        },
        "quality": {
            "rowsExtracted": int(len(pd.read_csv(dataset_path))),
            "rowsAccepted": int(len(prepared.rows)),
            "rowsRejected": int(prepared.discarded_rows),
            "syntheticRows": synthetic_rows,
            "realRows": int(len(prepared.rows) - synthetic_rows),
            "syntheticProportion": round4(synthetic_rows / max(len(prepared.rows), 1)),
            "nullsByColumn": {
                column: int(prepared.rows[column].isna().sum()) for column in CANONICAL_HEADERS
            },
        },
        "classDistribution": artifact["dataset"]["classDistribution"],
        "classWeights": artifact["dataset"]["classWeights"],
        "exploratoryAnalysisX": build_feature_report(prepared.rows, prepared.feature_columns),
        "evaluation": artifact["evaluation"],
    }

    model_card = f"""# Model card - clasificacion del resultado de servicios

## Proposito

Pronostica `completed_on_time`, `delayed` o `cancelled` al registrar o consultar
una orden activa. Es apoyo administrativo: no cambia estados, no bloquea
servicios y no toma decisiones clinicas.

## Datos y trazabilidad

- Unidad: una orden historica.
- CSV canonico: `05_Datasets/03_clasificacion_resultado_servicios.csv`.
- Artefacto serializado: `07_Modelos/classification_service_outcome_model.pkl`.
- Metadatos JSON: `07_Modelos/classification_service_outcome_model.json`.
- Y: `outcome`.
- X: {", ".join(artifact["dataset"]["predictorsX"])}.
- Solo auditoria, nunca X: ID, folio, fechas e `is_synthetic`.
- Periodo elegible: {artifact["dataset"]["eligiblePeriod"]["start"]} a {artifact["dataset"]["eligiblePeriod"]["end"]}.
- SHA-256 del CSV: `{dataset_sha256}`.

## Modelo y validacion

- Regresion logistica multinomial.
- Holdout temporal con {artifact["dataset"]["trainingSamples"]} filas de train y {artifact["dataset"]["evaluationTestSamples"]} de test.
- Accuracy: {artifact["evaluation"]["accuracy"]}.
- Accuracy baseline: {artifact["evaluation"]["baseline"]["accuracy"]}.
- Macro F1: {artifact["evaluation"]["macroAverage"]["f1Score"]}.
"""

    write_json(artifact_json_path, artifact)
    write_json(ml_artifact_json_path, artifact)
    write_pickle(artifact_pickle_path, model_bundle)
    write_pickle(ml_artifact_pickle_path, model_bundle)
    write_json(report_path, report)
    write_json(ml_report_path, report)
    model_card_path.write_text(model_card + "\n", encoding="utf-8")

    return {
        "dataset": str(dataset_path),
        "artifactJson": str(artifact_json_path),
        "artifactPkl": str(artifact_pickle_path),
        "report": str(report_path),
        "rows": int(len(prepared.rows)),
        "syntheticRows": synthetic_rows,
        "classDistribution": artifact["dataset"]["classDistribution"],
        "accuracy": artifact["evaluation"]["accuracy"],
        "baselineAccuracy": artifact["evaluation"]["baseline"]["accuracy"],
        "macroF1": artifact["evaluation"]["macroAverage"]["f1Score"],
    }


def predict_with_exported_model(payload: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    root = root or project_root()
    pickle_path = resolve_pickle_path(root, payload.get("modelPath"))
    if not pickle_path.exists():
        raise FileNotFoundError(
            f"The classification .pkl model does not exist: {pickle_path}"
        )
    with pickle_path.open("rb") as handler:
        bundle = pickle.load(handler)

    pipeline: Pipeline = bundle["pipeline"]
    feature_columns: list[str] = list(bundle["feature_columns"])
    inputs = payload.get("inputs") or []
    normalized_rows = []
    for input_row in inputs:
        normalized = {}
        for column in feature_columns:
            camel_key = snake_to_camel(column)
            raw_value = input_row.get(camel_key, input_row.get(column))
            if column in NUMERIC_FEATURE_COLUMNS:
                normalized[column] = (
                    float(raw_value)
                    if raw_value is not None and str(raw_value).strip() != ""
                    else np.nan
                )
            else:
                normalized[column] = normalize_category(raw_value)
        normalized_rows.append(normalized)

    if not normalized_rows:
        return {"predictions": []}

    frame = pd.DataFrame(normalized_rows, columns=feature_columns)
    probabilities = pipeline.predict_proba(frame)
    predicted = pipeline.predict(frame).tolist()
    return {
        "predictions": [
            {
                "outcome": predicted[index],
                "probability": round4(float(np.max(probabilities[index]))),
                "probabilities": {
                    outcome: round4(
                        float(probabilities[index][SERVICE_OUTCOME_CLASSES.index(outcome)])
                    )
                    for outcome in SERVICE_OUTCOME_CLASSES
                },
            }
            for index in range(len(predicted))
        ]
    }


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "train"
    if command == "predict":
        result = predict_with_exported_model(read_json_stdin())
        print(json.dumps(result, ensure_ascii=False))
        return

    if command in {"train", "train_csv"}:
        result = train_and_export()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    raise SystemExit(f"Unsupported command: {command}")


if __name__ == "__main__":
    main()
