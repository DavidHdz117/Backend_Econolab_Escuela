"""Entrena y exporta la regresion de precio de estudios de ECONOLAB.

No contiene credenciales ni rutas locales. Primero se genera el CSV con:
    cd backend
    npm run regression:export

Despues este archivo puede ejecutarse directamente o desde el notebook.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

RANDOM_SEED = 42
TEST_FRACTION = 0.20
RIDGE_ALPHA = 0.10


def project_root() -> Path:
    """Obtiene la raiz del backend, no la de una computadora especifica."""

    return Path(__file__).resolve().parents[2]


def normalize_category(value: object, fallback: str) -> str:
    """Normaliza igual que el backend TypeScript para hacer trazable la entrada."""

    text = str(value).strip().lower() if pd.notna(value) else ""
    text = "".join(
        character
        for character in unicodedata.normalize("NFD", text)
        if unicodedata.category(character) != "Mn"
    )
    text = " ".join(text.split())
    return text or fallback


def clean_dataset(raw: pd.DataFrame) -> pd.DataFrame:
    """Limpia nulos, duplicados y valores imposibles antes de separar datos."""

    required = {
        "study_id",
        "study_code",
        "study_name",
        "is_synthetic",
        "type",
        "method",
        "parameter_count",
        "normal_price",
    }
    missing = sorted(required.difference(raw.columns))
    if missing:
        raise ValueError(f"Faltan columnas en el CSV: {', '.join(missing)}")

    clean = raw.copy()
    clean["parameter_count"] = pd.to_numeric(
        clean["parameter_count"], errors="coerce"
    )
    clean["normal_price"] = pd.to_numeric(clean["normal_price"], errors="coerce")
    clean = clean.dropna(subset=["study_id", "parameter_count", "normal_price"])
    clean = clean.drop_duplicates(subset=["study_id"], keep="last")
    clean = clean[
        (clean["parameter_count"] >= 0)
        & (clean["normal_price"] > 0)
        & np.isfinite(clean["normal_price"])
    ].copy()
    clean["parameter_count"] = clean["parameter_count"].astype(int)
    clean["is_synthetic"] = clean["is_synthetic"].map(
        lambda value: str(value).strip().lower() in {"true", "1", "yes", "si"}
    )
    clean["type"] = clean["type"].map(lambda value: normalize_category(value, "study"))
    clean = clean[clean["type"] == "study"].copy()
    clean["method"] = clean["method"].map(
        lambda value: normalize_category(value, "sin_metodo")
    )
    return clean.sort_values("study_id").reset_index(drop=True)


def metric_values(real: pd.Series | np.ndarray, predicted: np.ndarray) -> dict:
    """Las tres metricas solicitadas por la rubrica."""

    return {
        "mae": float(mean_absolute_error(real, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(real, predicted))),
        "r2": float(r2_score(real, predicted)),
    }


def rounded_metrics(values: dict) -> dict:
    return {name: round(float(value), 4) for name, value in values.items()}


def train_and_export(root: Path | None = None) -> dict:
    root = root or project_root()
    dataset_path = root / "05_Datasets" / "02_regresion_estudios_dataset.csv"
    ml_root = root / "ml" / "regression"
    dataset = clean_dataset(pd.read_csv(dataset_path))

    if len(dataset) < 10:
        raise ValueError("Se necesitan al menos 10 estudios validos para entrenar.")

    feature_columns = ["parameter_count", "method"]
    target_column = "normal_price"
    # Se estratifica por procedencia para conservar una proporcion auditable
    # similar de datos reales/demostrativos en train y test. Esta columna no es X.
    stratify = (
        dataset["is_synthetic"]
        if dataset["is_synthetic"].nunique() > 1
        and dataset["is_synthetic"].value_counts().min() >= 2
        else None
    )

    # PASO 3: train y test se separan ANTES de ajustar transformaciones/modelo.
    train_rows, test_rows = train_test_split(
        dataset,
        test_size=TEST_FRACTION,
        random_state=RANDOM_SEED,
        shuffle=True,
        stratify=stratify,
    )
    train_rows = train_rows.sort_values("study_id").reset_index(drop=True)
    test_rows = test_rows.sort_values("study_id").reset_index(drop=True)

    dataset_directory = root / "05_Datasets"
    ml_data_directory = ml_root / "data"
    dataset_directory.mkdir(parents=True, exist_ok=True)
    ml_data_directory.mkdir(parents=True, exist_ok=True)
    train_rows.to_csv(
        dataset_directory / "02_regresion_estudios_train.csv", index=False
    )
    test_rows.to_csv(
        dataset_directory / "02_regresion_estudios_test.csv", index=False
    )
    dataset.to_csv(
        ml_data_directory / "02_regresion_estudios_dataset.csv", index=False
    )
    train_rows.to_csv(
        ml_data_directory / "02_regresion_estudios_train.csv", index=False
    )
    test_rows.to_csv(
        ml_data_directory / "02_regresion_estudios_test.csv", index=False
    )

    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            (
                "onehot",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
            ),
        ]
    )
    preprocessor = ColumnTransformer(
        transformers=[
            ("numeric", numeric_pipeline, ["parameter_count"]),
            ("categorical", categorical_pipeline, ["method"]),
        ],
        remainder="drop",
    )
    model = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("regressor", Ridge(alpha=RIDGE_ALPHA)),
        ]
    )

    # PASO 4: el modelo aprende SOLO con el conjunto de entrenamiento.
    model.fit(train_rows[feature_columns], train_rows[target_column])
    train_prediction = model.predict(train_rows[feature_columns])
    test_prediction = model.predict(test_rows[feature_columns])

    # Baseline justo: siempre predice el promedio aprendido en train.
    baseline = DummyRegressor(strategy="mean")
    baseline.fit(train_rows[feature_columns], train_rows[target_column])
    baseline_test_prediction = baseline.predict(test_rows[feature_columns])

    train_metrics = metric_values(train_rows[target_column], train_prediction)
    test_metrics = metric_values(test_rows[target_column], test_prediction)
    baseline_metrics = metric_values(
        test_rows[target_column], baseline_test_prediction
    )
    test_metrics_by_origin = {}
    for origin_name, synthetic_value in (("real", False), ("synthetic", True)):
        origin_mask = test_rows["is_synthetic"] == synthetic_value
        if int(origin_mask.sum()) >= 2:
            test_metrics_by_origin[origin_name] = {
                "samples": int(origin_mask.sum()),
                **rounded_metrics(
                    metric_values(
                        test_rows.loc[origin_mask, target_column],
                        test_prediction[origin_mask.to_numpy()],
                    )
                ),
            }

    residuals = test_rows[
        [
            "study_id",
            "study_code",
            "study_name",
            "is_synthetic",
            "method",
            "parameter_count",
            "normal_price",
        ]
    ].copy()
    residuals["predicted_price"] = np.round(test_prediction, 4)
    residuals["residual"] = np.round(
        residuals["normal_price"] - residuals["predicted_price"], 4
    )
    residuals.to_csv(
        dataset_directory / "02_regresion_reales_predichos_test.csv", index=False
    )
    residuals.to_csv(
        ml_data_directory / "02_regresion_reales_predichos_test.csv", index=False
    )

    fitted_preprocessor = model.named_steps["preprocessor"]
    numeric_scaler = fitted_preprocessor.named_transformers_["numeric"].named_steps[
        "scaler"
    ]
    onehot = fitted_preprocessor.named_transformers_["categorical"].named_steps[
        "onehot"
    ]
    regressor = model.named_steps["regressor"]
    method_categories = [str(value) for value in onehot.categories_[0].tolist()]
    ordered_features = [
        "parameter_count_scaled",
        *[f"method={value}" for value in method_categories],
    ]

    dataset_sha256 = hashlib.sha256(dataset_path.read_bytes()).hexdigest()
    dataset_synthetic = int(dataset["is_synthetic"].sum())
    train_synthetic = int(train_rows["is_synthetic"].sum())
    test_synthetic = int(test_rows["is_synthetic"].sum())
    artifact = {
        "schemaVersion": 1,
        "modelName": "econolab_study_normal_price",
        "modelVersion": "2.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "algorithm": "ridge_regression",
        "hyperparameters": {"alpha": RIDGE_ALPHA},
        "target": "normal_price",
        "rowUnit": "one_study",
        "randomSeed": RANDOM_SEED,
        "dataset": {
            "relativePath": "05_Datasets/02_regresion_estudios_dataset.csv",
            "sha256": dataset_sha256,
            "validRows": int(len(dataset)),
            "audit": {
                "syntheticRows": dataset_synthetic,
                "realRows": int(len(dataset) - dataset_synthetic),
                "syntheticFraction": round(dataset_synthetic / len(dataset), 6),
                "usedAsFeature": False,
            },
        },
        "split": {
            "strategy": "holdout_80_20",
            "testFraction": TEST_FRACTION,
            "trainingSamples": int(len(train_rows)),
            "testSamples": int(len(test_rows)),
            "audit": {
                "trainSyntheticRows": train_synthetic,
                "trainRealRows": int(len(train_rows) - train_synthetic),
                "trainSyntheticFraction": round(
                    train_synthetic / len(train_rows), 6
                ),
                "testSyntheticRows": test_synthetic,
                "testRealRows": int(len(test_rows) - test_synthetic),
                "testSyntheticFraction": round(test_synthetic / len(test_rows), 6),
            },
        },
        "features": {
            "input": ["parameter_count", "method"],
            "orderedEncoded": ordered_features,
            "numeric": {
                "parameter_count": {
                    "mean": float(numeric_scaler.mean_[0]),
                    "scale": float(numeric_scaler.scale_[0]),
                    "minimum": int(train_rows["parameter_count"].min()),
                    "maximum": int(train_rows["parameter_count"].max()),
                }
            },
            "categorical": {
                "method": method_categories,
            },
        },
        "coefficients": {
            "intercept": float(regressor.intercept_),
            "values": [float(value) for value in regressor.coef_.tolist()],
        },
        "metrics": {
            "train": rounded_metrics(train_metrics),
            "test": rounded_metrics(test_metrics),
            "testByOrigin": test_metrics_by_origin,
            "baselineTest": rounded_metrics(baseline_metrics),
        },
        "usage": {
            "suggestionOnly": True,
            "population": "active_individual_studies",
            "packagesSupported": False,
            "currency": "MXN",
            "priceMarginSource": "test_mae",
        },
    }

    model_directory = root / "07_Modelos"
    academic_ml_artifact_directory = ml_root / "artifacts"
    report_directory = ml_root / "reports"
    deployment_directory = root / "ml-artifacts"
    model_directory.mkdir(parents=True, exist_ok=True)
    academic_ml_artifact_directory.mkdir(parents=True, exist_ok=True)
    report_directory.mkdir(parents=True, exist_ok=True)
    deployment_directory.mkdir(parents=True, exist_ok=True)
    academic_artifact = model_directory / "regression_price_model.json"
    notebook_artifact = (
        academic_ml_artifact_directory / "regression_price_model.json"
    )
    deployment_artifact = deployment_directory / "regression_price_model.json"
    metrics_path = model_directory / "regression_metrics.json"
    notebook_metrics_path = report_directory / "regression_metrics.json"
    academic_artifact.write_text(
        json.dumps(artifact, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    notebook_artifact.write_text(
        json.dumps(artifact, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    shutil.copyfile(academic_artifact, deployment_artifact)
    metrics_path.write_text(
        json.dumps(artifact["metrics"], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    notebook_metrics_path.write_text(
        json.dumps(artifact["metrics"], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    return {
        "artifact": artifact,
        "artifact_path": str(academic_artifact),
        "notebook_artifact_path": str(notebook_artifact),
        "deployment_path": str(deployment_artifact),
        "residuals_path": str(
            dataset_directory / "02_regresion_reales_predichos_test.csv"
        ),
    }


if __name__ == "__main__":
    result = train_and_export()
    summary = {
        "message": "Modelo de regresion entrenado y exportado.",
        "split": result["artifact"]["split"],
        "metrics": result["artifact"]["metrics"],
        "artifact": result["artifact_path"],
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
