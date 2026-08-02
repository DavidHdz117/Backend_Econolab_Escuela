from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import math
import re

import pandas as pd

TARGET_STUDY_ROWS = 2000
TARGET_CLASSIFICATION_ROWS = 2000
TARGET_SYNTHETIC_STUDIES = 1952
TARGET_SYNTHETIC_ORDERS = 1988
CLASS_TARGETS = {
    "completed_on_time": 1193,
    "delayed": 596,
    "cancelled": 199,
}
AREA_CODES = ["QC", "HEM", "INM", "MIC", "COA", "END", "URO", "MOL"]
PRICE_TYPES = ["normal", "dif", "special", "hospital", "other"]
BRANCHES = [
    "Matriz",
    "Matriz - Centro",
    "SUCURSAL CENTRO",
    "SUCURSAL NORTE",
    "SUCURSAL SUR",
]


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def round_to_step(value: float, step: int = 10) -> float:
    return float(max(step, int(round(value / step) * step)))


def clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def to_bool_string(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return "true" if str(value).strip().lower() in {"true", "1", "yes", "si"} else "false"


def to_iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def load_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding="utf-8-sig")


def save_csv(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8-sig")


def build_augmented_study_rows(root: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    regression_path = root / "05_Datasets" / "02_regresion_estudios_dataset.csv"
    clustering_path = root / "05_Datasets" / "clustering_estudios.csv"
    regression = load_csv(regression_path)
    clustering = load_csv(clustering_path)

    regression["study_id"] = regression["study_id"].astype(int)
    clustering["study_id"] = clustering["study_id"].astype(int)

    if (
        "duration_minutes" not in regression.columns
        or "sample_type" not in regression.columns
        or "requires_special_processing" not in regression.columns
    ):
        clustering_projection = clustering[
            [
                "study_id",
                "delivery_hours",
                "sample_type",
                "requires_special_processing",
            ]
        ].copy()
        clustering_projection["duration_minutes"] = (
            pd.to_numeric(clustering_projection["delivery_hours"], errors="coerce")
            * 60
        ).round()
        regression = regression.merge(
            clustering_projection[
                [
                    "study_id",
                    "duration_minutes",
                    "sample_type",
                    "requires_special_processing",
                ]
            ],
            on="study_id",
            how="left",
        )

    synthetic_mask = regression["is_synthetic"].astype(str).str.lower().isin(["true", "1"])
    real_regression = regression.loc[~synthetic_mask].copy()
    synthetic_regression = regression.loc[synthetic_mask].copy()
    synthetic_clustering = clustering.loc[
        clustering["is_synthetic"].astype(str).str.lower().isin(["true", "1"])
    ].copy()

    if len(real_regression) + TARGET_SYNTHETIC_STUDIES != TARGET_STUDY_ROWS:
        raise ValueError("La configuracion esperada de filas de estudios no coincide con el dataset base.")

    merged = synthetic_regression.merge(
        synthetic_clustering,
        on="study_id",
        suffixes=("_reg", "_clu"),
        validate="one_to_one",
    )
    merged["area_code"] = merged["study_code"].str.extract(r"ECN-CAT-([A-Z]+)-")

    max_study_id = int(regression["study_id"].max())
    next_study_id = max_study_id + 1
    additional_rows_regression: list[dict[str, object]] = []
    additional_rows_clustering: list[dict[str, object]] = []

    area_index_lookup = {area: index for index, area in enumerate(AREA_CODES)}

    for area_code in AREA_CODES:
        area_rows = merged.loc[merged["area_code"] == area_code].sort_values("study_id").reset_index(drop=True)
        if len(area_rows) != 125:
            raise ValueError(f"Se esperaban 125 estudios sinteticos para el area {area_code} y existen {len(area_rows)}.")

        for offset, variant in enumerate(range(126, 245), start=0):
            base = area_rows.iloc[offset]
            area_index = area_index_lookup[area_code]
            price_shift = ((variant + area_index * 3) % 9 - 4) * 10
            parameter_shift = ((variant + area_index) % 5) - 2
            delivery_shift = (((variant + area_index) % 5) - 2) * 0.25
            request_shift = ((variant + area_index) % 4) - 1

            parameter_count = clamp_int(
                int(base["parameter_count_reg"]) + parameter_shift,
                1,
                60,
            )
            normal_price = round_to_step(float(base["normal_price"]) + price_shift + area_index * 5)
            delivery_hours = round(
                clamp_float(
                    float(base["delivery_hours"]) + delivery_shift + (0.25 if area_code in {"MIC", "MOL"} else 0.0),
                    0.25,
                    24.0,
                ),
                2,
            )
            request_count = clamp_int(
                int(base["request_count"]) + request_shift,
                0,
                12,
            )
            synthetic_request_count = clamp_int(
                min(
                    request_count,
                    int(base["synthetic_request_count"]) + (1 if variant % 6 == 0 else 0),
                ),
                0,
                request_count,
            )
            sample_type = base.get("sample_type_clu", base.get("sample_type_reg", "unknown"))
            requires_special_processing = base.get(
                "requires_special_processing_clu",
                base.get("requires_special_processing_reg"),
            )
            if pd.notna(requires_special_processing) and variant % 17 == 0:
                requires_special_processing = not str(requires_special_processing).strip().lower() in {"true", "1"}

            study_code = f"ECN-CAT-{area_code}-{variant:03d}"
            study_name = str(base["study_name"])

            additional_rows_regression.append(
                {
                    "study_id": next_study_id,
                    "study_code": study_code,
                    "study_name": study_name,
                    "is_synthetic": "true",
                    "type": "study",
                    "method": base["method"],
                    "parameter_count": parameter_count,
                    "duration_minutes": int(round(float(base["delivery_hours"]) * 60)),
                    "sample_type": sample_type,
                    "requires_special_processing": to_bool_string(requires_special_processing),
                    "normal_price": f"{normal_price:.2f}",
                }
            )
            additional_rows_clustering.append(
                {
                    "study_id": next_study_id,
                    "code": study_code,
                    "name": str(base["name"]),
                    "price": f"{normal_price:.0f}",
                    "delivery_hours": delivery_hours,
                    "parameter_count": parameter_count,
                    "request_count": request_count,
                    "synthetic_request_count": synthetic_request_count,
                    "sample_type": sample_type,
                    "analysis_method": base["analysis_method"],
                    "requires_special_processing": to_bool_string(requires_special_processing),
                    "is_synthetic": "true",
                }
            )
            next_study_id += 1

    updated_regression = pd.concat(
        [regression, pd.DataFrame(additional_rows_regression)],
        ignore_index=True,
    ).sort_values("study_id").reset_index(drop=True)
    if len(clustering) >= TARGET_STUDY_ROWS:
        updated_clustering = clustering.sort_values("study_id").reset_index(drop=True)
    else:
        updated_clustering = pd.concat(
            [clustering, pd.DataFrame(additional_rows_clustering)],
            ignore_index=True,
        ).sort_values("study_id").reset_index(drop=True)

    if len(updated_regression) != TARGET_STUDY_ROWS or len(updated_clustering) != TARGET_STUDY_ROWS:
        raise ValueError("No se alcanzo el total esperado de filas para estudios.")

    return updated_regression, updated_clustering


def distribute_labels(quota: dict[str, int]) -> list[str]:
    produced = Counter()
    labels: list[str] = []
    total = sum(quota.values())
    ordered_classes = list(quota.keys())
    for position in range(total):
        best_class = max(
            ordered_classes,
            key=lambda label: (quota[label] * (position + 1) / total) - produced[label],
        )
        produced[best_class] += 1
        labels.append(best_class)
    return labels


def build_augmented_classification_rows(root: Path) -> pd.DataFrame:
    dataset_path = root / "05_Datasets" / "03_clasificacion_resultado_servicios.csv"
    dataset = load_csv(dataset_path)

    synthetic_mask = dataset["is_synthetic"].astype(str).str.lower().isin(["true", "1"])
    synthetic_rows = dataset.loc[synthetic_mask].copy().reset_index(drop=True)
    real_rows = dataset.loc[~synthetic_mask].copy().reset_index(drop=True)

    if len(real_rows) + TARGET_SYNTHETIC_ORDERS != TARGET_CLASSIFICATION_ROWS:
        raise ValueError("La configuracion esperada de filas de clasificacion no coincide con el dataset base.")

    current_synthetic_by_class = Counter(synthetic_rows["outcome"])
    additions_by_class = {
        label: CLASS_TARGETS[label] - current_synthetic_by_class.get(label, 0)
        for label in CLASS_TARGETS
    }
    if any(count < 0 for count in additions_by_class.values()):
        raise ValueError("La distribucion sintetica objetivo es menor a la ya existente.")

    labels = distribute_labels(additions_by_class)
    templates_by_class = {
        label: synthetic_rows.loc[synthetic_rows["outcome"] == label].reset_index(drop=True)
        for label in CLASS_TARGETS
    }
    per_class_index = defaultdict(int)

    existing_max_order_id = int(dataset["order_id"].astype(int).max())
    next_order_id = existing_max_order_id + 1
    next_sequence_number = int(
        synthetic_rows["source_folio"].astype(str).str.replace("ECO-ML-", "", regex=False).astype(int).max()
    ) + 1

    start_at = datetime(2025, 11, 2, 0, 0, tzinfo=timezone.utc)
    end_at = datetime(2026, 7, 31, 18, 0, tzinfo=timezone.utc)
    total_span_seconds = int((end_at - start_at).total_seconds())
    rows_to_add: list[dict[str, object]] = []

    for position, outcome in enumerate(labels):
        templates = templates_by_class[outcome]
        template = templates.iloc[per_class_index[outcome] % len(templates)]
        per_class_index[outcome] += 1
        fraction = position / max(len(labels) - 1, 1)
        created_at = start_at + timedelta(seconds=round(total_span_seconds * fraction))
        created_at += timedelta(minutes=(position * 11) % 37)

        base_promised = float(template["promised_lead_hours"])
        base_items = int(template["item_count"])
        base_subtotal = float(template["subtotal_amount"])
        base_courtesy = float(template["courtesy_percent"])
        class_index = {"completed_on_time": 0, "delayed": 1, "cancelled": 2}[outcome]

        lead_adjustment = {
            "completed_on_time": ((position % 5) - 2) * 2,
            "delayed": 6 + (position % 7),
            "cancelled": -4 + (position % 9),
        }[outcome]
        promised_lead_hours = clamp_float(base_promised + lead_adjustment, 4.0, 96.0)

        item_count = clamp_int(
            base_items
            + (1 if outcome == "delayed" and position % 3 == 0 else 0)
            - (1 if outcome == "completed_on_time" and position % 5 == 0 else 0),
            1,
            6,
        )
        total_quantity = clamp_int(
            item_count + (1 if outcome != "completed_on_time" and position % 4 == 0 else 0),
            item_count,
            9,
        )
        distinct_study_count = clamp_int(item_count - (1 if total_quantity > item_count and position % 2 == 0 else 0), 1, item_count)
        package_component_count = 1 if position % 73 == 0 else 0

        subtotal_amount = round(
            max(
                75.0,
                base_subtotal
                + ((position + class_index * 5) % 9 - 4) * 45
                + (item_count - base_items) * 95,
            ),
            2,
        )
        courtesy_percent = max(
            0.0,
            min(
                20.0,
                base_courtesy + ((position + class_index) % 4 - 1) * 5,
            ),
        )
        discount_amount = round(subtotal_amount * courtesy_percent / 100.0, 2)
        total_amount = round(subtotal_amount - discount_amount, 2)

        source_updated_at = created_at + timedelta(hours=promised_lead_hours)
        if outcome == "completed_on_time":
            source_updated_at -= timedelta(hours=1 + (position % 6))
        elif outcome == "delayed":
            source_updated_at += timedelta(hours=2 + (position % 18))
        else:
            source_updated_at = created_at + timedelta(hours=2 + (position % 48))

        branch_name = BRANCHES[(position + class_index) % len(BRANCHES)]
        dominant_price_type = PRICE_TYPES[(position + class_index) % len(PRICE_TYPES)]

        rows_to_add.append(
            {
                "order_id": next_order_id,
                "source_folio": f"ECO-ML-{next_sequence_number:06d}",
                "is_synthetic": "true",
                "source_created_at": to_iso_z(created_at),
                "source_updated_at": to_iso_z(source_updated_at),
                "promised_lead_hours": round(promised_lead_hours, 4),
                "registration_hour": round(created_at.hour + created_at.minute / 60.0, 4),
                "registration_weekday": (created_at.weekday() + 1) % 7,
                "item_count": item_count,
                "total_quantity": total_quantity,
                "distinct_study_count": distinct_study_count,
                "package_component_count": package_component_count,
                "subtotal_amount": f"{subtotal_amount:.2f}",
                "courtesy_percent": f"{courtesy_percent:.2f}",
                "discount_amount": f"{discount_amount:.2f}",
                "total_amount": f"{total_amount:.2f}",
                "branch_name": branch_name,
                "dominant_price_type": dominant_price_type,
                "outcome": outcome,
            }
        )
        next_order_id += 1
        next_sequence_number += 1

    updated = pd.concat([dataset, pd.DataFrame(rows_to_add)], ignore_index=True)
    updated["order_id"] = updated["order_id"].astype(int)
    updated["sort_created_at"] = pd.to_datetime(updated["source_created_at"], utc=True)
    updated = updated.sort_values(["sort_created_at", "order_id"]).drop(columns=["sort_created_at"]).reset_index(drop=True)

    if len(updated) != TARGET_CLASSIFICATION_ROWS:
        raise ValueError("No se alcanzo el total esperado de filas para clasificacion.")

    return updated


def persist_outputs(
    root: Path,
    regression: pd.DataFrame,
    clustering: pd.DataFrame,
    classification: pd.DataFrame,
) -> None:
    save_csv(regression, root / "05_Datasets" / "02_regresion_estudios_dataset.csv")
    save_csv(regression, root / "ml" / "regression" / "data" / "02_regresion_estudios_dataset.csv")

    save_csv(clustering, root / "05_Datasets" / "clustering_estudios.csv")
    save_csv(clustering, root / "ml" / "clustering" / "data" / "clustering_estudios.csv")

    save_csv(classification, root / "05_Datasets" / "03_clasificacion_resultado_servicios.csv")
    save_csv(classification, root / "ml" / "classification" / "data" / "classification_service_outcomes.csv")


def main() -> None:
    root = project_root()
    regression, clustering = build_augmented_study_rows(root)
    classification = build_augmented_classification_rows(root)
    persist_outputs(root, regression, clustering, classification)

    print(
        {
            "regression_rows": len(regression),
            "clustering_rows": len(clustering),
            "classification_rows": len(classification),
            "regression_synthetic": int(
                regression["is_synthetic"].astype(str).str.lower().isin(["true", "1"]).sum()
            ),
            "classification_synthetic": int(
                classification["is_synthetic"].astype(str).str.lower().isin(["true", "1"]).sum()
            ),
        }
    )


if __name__ == "__main__":
    main()
