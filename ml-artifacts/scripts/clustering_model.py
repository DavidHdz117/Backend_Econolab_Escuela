"""Train and use the ECONOLAB clustering model in Python."""

from __future__ import annotations

import json
import math
import os
import pickle
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

from sklearn.cluster import KMeans
from sklearn.metrics import davies_bouldin_score, silhouette_score

NUMERIC_FEATURES = ["price", "deliveryHours", "parameterCount", "requestCount"]
MAX_CATEGORIES = 20
MAX_ITERATIONS = 100
EPSILON = 1e-6
STUDY_CLUSTERING_RANDOM_SEED = 20260721
UNKNOWN_CATEGORIES = {
    "unknown",
    "sin_especificar",
    "desconocido",
    "no_especificado",
}


@dataclass
class PreparedRows:
    rows: list[dict[str, Any]]
    unique_rows: int
    duplicate_rows: int
    imputed_values: dict[str, int]
    medians: dict[str, float]
    requires_special_processing_mode: bool
    warnings: list[str]


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def round_value(value: float, decimals: int) -> float:
    return round(float(value), decimals)


def truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes", "si"}


def normalize_category(value: object) -> str:
    text = "" if value is None or (isinstance(value, float) and math.isnan(value)) else str(value)
    text = text.strip().lower()
    text = "".join(
        character
        for character in unicodedata.normalize("NFD", text)
        if unicodedata.category(character) != "Mn"
    )
    text = " ".join(text.split())
    return text or "sin_especificar"


def is_unknown_category(value: str) -> bool:
    return value.strip().lower() in UNKNOWN_CATEGORIES


def to_display_category(value: str) -> str:
    normalized = value.strip().lower().replace("_", " ").replace("-", " ")
    translations = {
        "blood": "Sangre total",
        "serum": "Suero",
        "plasma": "Plasma",
        "urine": "Orina",
        "stool": "Heces",
        "swab": "Hisopo",
        "other": "Otra",
        "pcr": "PCR",
        "elisa": "ELISA",
        "enzimatico": "Enzimático",
        "inmunoensayo": "Inmunoensayo",
        "espectrofotometria": "Espectrofotometría",
        "colorimetria": "Colorimetría",
        "coagulometria": "Coagulometría",
        "quimioluminiscencia": "Quimioluminiscencia",
        "quimica seca": "Química seca",
        "microbiologia": "Microbiología",
        "inmunofluorescencia": "Inmunofluorescencia",
        "cromatografia": "Cromatografía",
        "electroforesis": "Electroforesis",
        "automatizado": "Automatizado",
        "biopsia": "Biopsia",
    }
    if normalized in translations:
        return translations[normalized]
    return " ".join(part.capitalize() for part in normalized.split())


def format_currency(value: float) -> str:
    return f"${value:,.0f} MXN"


def is_positive_number(value: object) -> bool:
    return value is not None and isinstance(value, (int, float)) and math.isfinite(value) and float(value) > 0


def is_non_negative_number(value: object) -> bool:
    return value is not None and isinstance(value, (int, float)) and math.isfinite(value) and float(value) >= 0


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    return float(np.median(np.asarray(values, dtype=float)))


def quantile(sorted_values: list[float], value: float) -> float:
    if not sorted_values:
        return 0.0
    return float(np.quantile(np.asarray(sorted_values, dtype=float), value))


def read_json_stdin() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def prepare_rows(rows: list[dict[str, Any]]) -> PreparedRows:
    unique: dict[int, dict[str, Any]] = {}
    duplicate_rows = 0

    for row in sorted(rows, key=lambda item: int(item.get("studyId", 0) or 0)):
        study_id = row.get("studyId")
        if not isinstance(study_id, int) or study_id <= 0:
            continue
        if study_id in unique:
            duplicate_rows += 1
            continue
        unique[study_id] = row

    unique_rows = list(unique.values())
    medians = {
        "price": median(
            [float(row["price"]) for row in unique_rows if is_positive_number(row.get("price"))]
        ),
        "deliveryHours": median(
            [
                float(row["deliveryHours"])
                for row in unique_rows
                if is_positive_number(row.get("deliveryHours"))
            ]
        ),
        "parameterCount": median(
            [
                float(row["parameterCount"])
                for row in unique_rows
                if is_non_negative_number(row.get("parameterCount"))
            ]
        ),
        "requestCount": median(
            [
                float(row["requestCount"])
                for row in unique_rows
                if is_non_negative_number(row.get("requestCount"))
            ]
        ),
    }
    imputed_values = {
        "price": 0,
        "deliveryHours": 0,
        "parameterCount": 0,
        "requestCount": 0,
        "requiresSpecialProcessing": 0,
    }
    known_special_processing = [
        bool(row["requiresSpecialProcessing"])
        for row in unique_rows
        if isinstance(row.get("requiresSpecialProcessing"), bool)
    ]
    true_count = sum(known_special_processing)
    special_processing_mode = true_count > (len(known_special_processing) - true_count)

    clean_rows: list[dict[str, Any]] = []
    for row in unique_rows:
        def get_number(key: str, positive_only: bool = False) -> float:
            value = row.get(key)
            valid = is_positive_number(value) if positive_only else is_non_negative_number(value)
            if not valid:
                imputed_values[key] += 1
                return medians[key]
            return float(value)

        requires_special_processing = row.get("requiresSpecialProcessing")
        if not isinstance(requires_special_processing, bool):
            imputed_values["requiresSpecialProcessing"] += 1
            requires_special_processing = special_processing_mode

        clean_rows.append(
            {
                "studyId": int(row["studyId"]),
                "code": str(row.get("code") or f"ESTUDIO-{row['studyId']}").strip(),
                "name": str(row.get("name") or "Estudio sin nombre").strip(),
                "price": get_number("price", positive_only=True),
                "deliveryHours": get_number("deliveryHours", positive_only=True),
                "parameterCount": round(get_number("parameterCount")),
                "requestCount": round(get_number("requestCount")),
                "sampleType": normalize_category(row.get("sampleType")),
                "analysisMethod": normalize_category(row.get("analysisMethod")),
                "requiresSpecialProcessing": bool(requires_special_processing),
                "isSynthetic": row.get("isSynthetic") is True,
            }
        )

    warnings: list[str] = []
    if any(imputed_values[key] > 0 for key in NUMERIC_FEATURES):
        warnings.append(
            "Los valores numericos faltantes o incorrectos se imputaron con la mediana."
        )
    if imputed_values["requiresSpecialProcessing"] > 0:
        warnings.append(
            "Los valores desconocidos de procesamiento especial se imputaron con la moda."
        )
    if any(row["isSynthetic"] for row in clean_rows):
        warnings.append(
            "El analisis incluye estudios sinteticos ECN-CAT identificados para auditoria; isSynthetic no se usa como variable de K-Means."
        )

    return PreparedRows(
        rows=clean_rows,
        unique_rows=len(unique_rows),
        duplicate_rows=duplicate_rows,
        imputed_values=imputed_values,
        medians=medians,
        requires_special_processing_mode=special_processing_mode,
        warnings=warnings,
    )


def category_config(values: list[str]) -> dict[str, Any]:
    known_values = [value for value in values if not is_unknown_category(value)]
    if len(known_values) < 3 or len(known_values) / max(len(values), 1) < 0.5:
        return {
            "categories": [],
            "map": lambda value: None,
            "excludedForCoverage": True,
        }

    frequencies = Counter(known_values)
    ordered = sorted(frequencies.items(), key=lambda item: (-item[1], item[0]))
    minimum_frequency = max(2, math.ceil(max(len(known_values), 1) * 0.01))
    kept = [value for value, count in ordered if count >= minimum_frequency][: MAX_CATEGORIES - 1]
    has_other = len(ordered) > len(kept)
    categories = sorted([*kept, *(["otros"] if has_other else [])])

    def map_value(value: str) -> str | None:
        if is_unknown_category(value):
            return None
        return value if value in kept else ("otros" if has_other else None)

    return {
        "categories": categories,
        "map": map_value,
        "excludedForCoverage": False,
    }


def encode_and_scale(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ignored_constant_features: list[str] = []
    means: dict[str, float] = {}
    deviations: dict[str, float] = {}
    lower_bounds: dict[str, float] = {}
    upper_bounds: dict[str, float] = {}
    tail_quantile = 0.05 if len(rows) < 100 else 0.01
    winsorization_percentiles = {
        "lower": tail_quantile * 100,
        "upper": (1 - tail_quantile) * 100,
    }
    winsorized_values = {
        "price": 0,
        "deliveryHours": 0,
        "parameterCount": 0,
        "requestCount": 0,
    }

    def model_value(row: dict[str, Any], key: str) -> float:
        return min(upper_bounds[key], max(lower_bounds[key], float(row[key])))

    for key in NUMERIC_FEATURES:
        sorted_values = sorted(float(row[key]) for row in rows)
        lower_bound = quantile(sorted_values, tail_quantile)
        upper_bound = quantile(sorted_values, 1 - tail_quantile)
        lower_bounds[key] = lower_bound
        upper_bounds[key] = upper_bound
        winsorized_values[key] = len(
            [value for value in sorted_values if value < lower_bound or value > upper_bound]
        )
        clipped_values = [model_value(row, key) for row in rows]
        mean = float(np.mean(clipped_values))
        deviation = float(np.std(clipped_values)) or 1.0
        means[key] = mean
        deviations[key] = deviation

    sample_config = category_config([row["sampleType"] for row in rows])
    method_config = category_config([row["analysisMethod"] for row in rows])
    if sample_config["excludedForCoverage"]:
        ignored_constant_features.append("sample_type (cobertura insuficiente)")
    if method_config["excludedForCoverage"]:
        ignored_constant_features.append("analysis_method (cobertura insuficiente)")

    all_feature_names = [
        "price",
        "delivery_hours",
        "parameter_count",
        "request_count",
        *[f"sample_type={value}" for value in sample_config["categories"]],
        *[f"analysis_method={value}" for value in method_config["categories"]],
        "requires_special_processing",
    ]
    all_vectors = []
    for row in rows:
        mapped_sample = sample_config["map"](row["sampleType"])
        mapped_method = method_config["map"](row["analysisMethod"])
        vector = [
            *[
                (model_value(row, key) - means[key]) / deviations[key]
                for key in NUMERIC_FEATURES
            ],
            *[
                1 if mapped_sample == category else 0
                for category in sample_config["categories"]
            ],
            *[
                1 if mapped_method == category else 0
                for category in method_config["categories"]
            ],
            1 if row["requiresSpecialProcessing"] else 0,
        ]
        all_vectors.append(vector)

    variable_indexes = []
    for index, feature_name in enumerate(all_feature_names):
        first_value = all_vectors[0][index]
        is_constant = all(abs(vector[index] - first_value) < EPSILON for vector in all_vectors)
        if is_constant:
            ignored_constant_features.append(feature_name)
            continue
        variable_indexes.append(index)

    feature_names = [all_feature_names[index] for index in variable_indexes]
    vectors = [[vector[index] for index in variable_indexes] for vector in all_vectors]

    return {
        "vectors": vectors,
        "featureNames": feature_names,
        "ignoredConstantFeatures": ignored_constant_features,
        "winsorizedValues": winsorized_values,
        "winsorizationPercentiles": winsorization_percentiles,
        "means": means,
        "deviations": deviations,
        "lowerBounds": lower_bounds,
        "upperBounds": upper_bounds,
        "sampleTypeCategories": sample_config["categories"],
        "analysisMethodCategories": method_config["categories"],
    }


def initialize_centroids(points: list[list[float]], k: int, start: int) -> np.ndarray:
    point_array = np.asarray(points, dtype=float)
    mean = point_array.mean(axis=0)
    distances = [
        {"index": index, "distance": float(np.sum((point - mean) ** 2))}
        for index, point in enumerate(point_array)
    ]
    ordered = sorted(distances, key=lambda item: (item["distance"], item["index"]))
    first_positions = [0, len(ordered) - 1, len(ordered) // 2]
    selected = [ordered[first_positions[start % len(first_positions)]]["index"]]

    while len(selected) < k:
        best_index = -1
        best_distance = -1.0
        for index in range(len(point_array)):
            if index in selected:
                continue
            distance = min(
                float(np.sum((point_array[index] - point_array[selected_index]) ** 2))
                for selected_index in selected
            )
            if distance > best_distance:
                best_distance = distance
                best_index = index
        selected.append(best_index)

    return point_array[selected]


def fit_best(points: list[list[float]], k: int) -> dict[str, Any]:
    point_array = np.asarray(points, dtype=float)
    best: dict[str, Any] | None = None
    for start in range(3):
        initial_centroids = initialize_centroids(points, k, start)
        model = KMeans(
            n_clusters=k,
            init=initial_centroids,
            n_init=1,
            max_iter=MAX_ITERATIONS,
            random_state=STUDY_CLUSTERING_RANDOM_SEED,
            algorithm="lloyd",
        )
        labels = model.fit_predict(point_array)
        distances = np.linalg.norm(point_array - model.cluster_centers_[labels], axis=1)
        candidate = {
            "labels": labels.tolist(),
            "centroids": model.cluster_centers_.tolist(),
            "distances": distances.tolist(),
            "inertia": float(model.inertia_),
            "iterations": int(model.n_iter_),
        }
        if best is None or candidate["inertia"] < best["inertia"]:
            best = candidate
    assert best is not None
    return best


def find_elbow(evaluations: list[dict[str, Any]]) -> int:
    if len(evaluations) <= 2:
        return int(evaluations[0]["k"])
    first = evaluations[0]
    last = evaluations[-1]
    dx = last["k"] - first["k"]
    dy = last["inertia"] - first["inertia"]
    denominator = math.sqrt(dx ** 2 + dy ** 2) or 1.0
    interior = []
    for point in evaluations[1:-1]:
        distance = abs(
            dy * point["k"]
            - dx * point["inertia"]
            + last["k"] * first["inertia"]
            - last["inertia"] * first["k"]
        ) / denominator
        interior.append({"k": point["k"], "distance": distance})
    interior.sort(key=lambda item: (-item["distance"], item["k"]))
    return int(interior[0]["k"])


def averages(rows: list[dict[str, Any]]) -> dict[str, float]:
    return {
        "price": float(np.mean([row["price"] for row in rows])),
        "deliveryHours": float(np.mean([row["deliveryHours"] for row in rows])),
        "parameterCount": float(np.mean([row["parameterCount"] for row in rows])),
        "requestCount": float(np.mean([row["requestCount"] for row in rows])),
    }


def numeric_distributions(rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    distributions = {}
    for key in NUMERIC_FEATURES:
        values = sorted(float(row[key]) for row in rows)
        distributions[key] = {
            "p33": quantile(values, 0.33),
            "median": quantile(values, 0.5),
            "p66": quantile(values, 0.66),
        }
    return distributions


def round_distributions(distributions: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    return {
        key: {
            "p33": round_value(values["p33"], 2),
            "median": round_value(values["median"], 2),
            "p66": round_value(values["p66"], 2),
        }
        for key, values in distributions.items()
    }


def category_summary(values: list[str]) -> list[dict[str, Any]]:
    frequencies = Counter(value for value in values if not is_unknown_category(value))
    ordered = sorted(frequencies.items(), key=lambda item: (-item[1], item[0]))[:5]
    return [
        {
            "value": value,
            "count": count,
            "percentage": round_value((count / max(len(values), 1)) * 100, 1),
        }
        for value, count in ordered
    ]


def predominant_category(values: list[str]) -> str | None:
    known = [value for value in values if not is_unknown_category(value)]
    if len(known) < 3 or len(known) / max(len(values), 1) < 0.5:
        return None
    frequencies = Counter(known)
    value, count = sorted(frequencies.items(), key=lambda item: (-item[1], item[0]))[0]
    if count / max(len(known), 1) < 0.6:
        return None
    return to_display_category(value)


def has_numeric_feature(feature_names: set[str], key: str) -> bool:
    mapping = {
        "price": "price",
        "deliveryHours": "delivery_hours",
        "parameterCount": "parameter_count",
        "requestCount": "request_count",
    }
    return mapping[key] in feature_names


def has_category_feature(feature_names: set[str], prefix: str) -> bool:
    return any(name.startswith(prefix) for name in feature_names)


def suggest_business_action(traits: list[str]) -> str:
    has = lambda trait: trait in traits
    if has("demanda alta") and has("entrega rápida"):
        return "Vigilar capacidad, reactivos y continuidad para sostener la demanda sin aumentar el tiempo de entrega."
    if has("entrega prolongada") or has("procesamiento especial frecuente"):
        return "Revisar disponibilidad de equipo, reactivos y tiempos comprometidos para prevenir retrasos operativos."
    if has("precio alto") and has("demanda baja"):
        return "Revisar costos, disponibilidad y vigencia dentro del catalogo antes de mantener capacidad dedicada."
    if has("multiparámetro"):
        return "Planear capacidad de captura y procesamiento por tratarse de estudios con varios resultados."
    if has("precio bajo") or has("demanda alta"):
        return "Mantener existencias minimas y monitorear el volumen para conservar una operacion eficiente."
    return "Revisar periodicamente precio, demanda y tiempo de entrega para detectar cambios en el comportamiento del segmento."


def interpret_profile(
    cluster_averages: dict[str, float],
    distributions: dict[str, dict[str, float]],
    feature_names: set[str],
    study_count: int,
    outlier_count: int,
    special_processing_percentage: float,
    predominant_method: str | None,
    predominant_sample_type: str | None,
) -> dict[str, Any]:
    traits: list[str] = []
    name_qualifiers: list[str] = []
    key_characteristics: list[str] = []

    def add(condition: bool, trait: str, qualifier: str, characteristic: str) -> None:
        if not condition:
            return
        traits.append(trait)
        name_qualifiers.append(qualifier)
        key_characteristics.append(characteristic)

    add(
        has_numeric_feature(feature_names, "price")
        and cluster_averages["price"] < distributions["price"]["p33"],
        "precio bajo",
        "accesibles",
        f"Precio promedio {format_currency(cluster_averages['price'])}, dentro del tercio inferior del catalogo.",
    )
    add(
        has_numeric_feature(feature_names, "price")
        and cluster_averages["price"] > distributions["price"]["p66"],
        "precio alto",
        "de mayor costo",
        f"Precio promedio {format_currency(cluster_averages['price'])}, dentro del tercio superior del catalogo.",
    )
    add(
        has_numeric_feature(feature_names, "requestCount")
        and cluster_averages["requestCount"] > distributions["requestCount"]["p66"],
        "demanda alta",
        "frecuentes",
        f"{round_value(cluster_averages['requestCount'], 1)} solicitudes promedio, dentro del tercio de mayor demanda.",
    )
    add(
        has_numeric_feature(feature_names, "requestCount")
        and cluster_averages["requestCount"] < distributions["requestCount"]["p33"],
        "demanda baja",
        "de demanda ocasional",
        f"{round_value(cluster_averages['requestCount'], 1)} solicitudes promedio, dentro del tercio de menor demanda.",
    )
    add(
        has_numeric_feature(feature_names, "deliveryHours")
        and cluster_averages["deliveryHours"] < distributions["deliveryHours"]["p33"],
        "entrega rápida",
        "de entrega rápida",
        f"{round_value(cluster_averages['deliveryHours'], 1)} horas de entrega promedio, dentro del tercio mas rapido.",
    )
    add(
        has_numeric_feature(feature_names, "deliveryHours")
        and cluster_averages["deliveryHours"] > distributions["deliveryHours"]["p66"],
        "entrega prolongada",
        "de entrega prolongada",
        f"{round_value(cluster_averages['deliveryHours'], 1)} horas de entrega promedio, dentro del tercio mas prolongado.",
    )
    add(
        has_numeric_feature(feature_names, "parameterCount")
        and cluster_averages["parameterCount"] > distributions["parameterCount"]["p66"],
        "multiparámetro",
        "multiparámetro",
        f"{round_value(cluster_averages['parameterCount'], 1)} parámetros promedio, dentro del tercio superior.",
    )
    add(
        "requires_special_processing" in feature_names
        and special_processing_percentage >= 60,
        "procesamiento especial frecuente",
        "de procesamiento especializado",
        f"{round_value(special_processing_percentage, 1)} % requiere procesamiento especial.",
    )

    if predominant_method:
        key_characteristics.append(f"Método predominante: {predominant_method}.")
    if predominant_sample_type:
        key_characteristics.append(f"Muestra predominante: {predominant_sample_type}.")
    if outlier_count > 0:
        label = "estudio atípico detectado" if outlier_count == 1 else "estudios atípicos detectados"
        key_characteristics.append(f"{outlier_count} {label}.")

    fallback_qualifier = (
        f"de {predominant_method}"
        if predominant_method
        else f"con muestra {predominant_sample_type}"
        if predominant_sample_type
        else "de operación estándar"
    )
    selected_qualifiers = name_qualifiers[:2]
    suggested_name = (
        f"Estudios {' y '.join(selected_qualifiers)}"
        if selected_qualifiers
        else f"Estudios {fallback_qualifier}"
    )
    short_description = (
        f"{study_count} estudios con precio promedio de {format_currency(cluster_averages['price'])}, "
        f"entrega de {round_value(cluster_averages['deliveryHours'], 1)} horas, "
        f"{round_value(cluster_averages['parameterCount'], 1)} parámetros y "
        f"{round_value(cluster_averages['requestCount'], 1)} solicitudes en el periodo."
    )
    return {
        "suggestedName": suggested_name,
        "shortDescription": short_description,
        "keyCharacteristics": key_characteristics[:6],
        "suggestedAction": suggest_business_action(traits),
        "nameQualifiers": name_qualifiers,
        "traits": traits,
    }


def normalize_name_key(value: str) -> str:
    text = "".join(
        character
        for character in unicodedata.normalize("NFD", value.strip().lower())
        if unicodedata.category(character) != "Mn"
    )
    return " ".join(text.split())


def resolve_suggested_name_collisions(profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    used: set[str] = set()
    for profile in profiles:
        base_name = profile["suggestedName"]
        candidates = [
            base_name,
            *(
                [f"{base_name} y {profile['nameQualifiers'][2]}"]
                if len(profile["nameQualifiers"]) > 2
                else []
            ),
            *(
                [f"{base_name} · {profile['predominantMethod']}"]
                if profile["predominantMethod"]
                else []
            ),
            *(
                [f"{base_name} · muestra {profile['predominantSampleType']}"]
                if profile["predominantSampleType"]
                else []
            ),
            f"{base_name} · precio promedio {format_currency(profile['averages']['price'])}",
            f"{base_name} · entrega promedio {round_value(profile['averages']['deliveryHours'], 1)} h",
            f"{base_name} · {round_value(profile['averages']['parameterCount'], 1)} parámetros",
            f"{base_name} · {round_value(profile['averages']['requestCount'], 1)} solicitudes",
        ]
        selected = next(
            (candidate for candidate in candidates if normalize_name_key(candidate) not in used),
            base_name,
        )
        profile["suggestedName"] = selected[:150]
        used.add(normalize_name_key(profile["suggestedName"]))
    return profiles


def build_findings(
    profiles: list[dict[str, Any]],
    studies: list[dict[str, Any]],
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    drafts: list[dict[str, Any]] = []
    for profile in profiles:
        uses = lambda trait: trait in profile["traits"]
        if uses("demanda alta") and uses("entrega rápida"):
            drafts.append(
                {
                    "type": "opportunity",
                    "titleTemplate": "Capacidad operativa en {profileName}",
                    "descriptionTemplate": (
                        f"{{profileName}} concentra {profile['averages']['requestCount']} solicitudes promedio con una entrega de "
                        f"{profile['averages']['deliveryHours']} horas; es un segmento prioritario para vigilar capacidad y continuidad."
                    ),
                    "profileCluster": profile["cluster"],
                }
            )
        if uses("precio alto") and uses("demanda baja"):
            drafts.append(
                {
                    "type": "observation",
                    "titleTemplate": "Alto valor y baja frecuencia en {profileName}",
                    "descriptionTemplate": (
                        f"{{profileName}} combina un precio promedio de {format_currency(profile['averages']['price'])} "
                        f"con {profile['averages']['requestCount']} solicitudes; conviene revisar disponibilidad y costos administrativos."
                    ),
                    "profileCluster": profile["cluster"],
                }
            )
        if uses("entrega prolongada"):
            drafts.append(
                {
                    "type": "risk",
                    "titleTemplate": "Seguimiento de entrega en {profileName}",
                    "descriptionTemplate": (
                        f"{{profileName}} registra {profile['averages']['deliveryHours']} horas de entrega promedio, dentro del tercio mas prolongado del catalogo."
                    ),
                    "profileCluster": profile["cluster"],
                }
            )
        if profile["specialProcessingPercentage"] >= 60:
            drafts.append(
                {
                    "type": "risk",
                    "titleTemplate": "Procesamiento especial en {profileName}",
                    "descriptionTemplate": (
                        f"El {profile['specialProcessingPercentage']} % de {{profileName}} requiere procesamiento especial; "
                        "el hallazgo sirve para planeacion operativa."
                    ),
                    "profileCluster": profile["cluster"],
                }
            )
        if profile["outlierCount"] > 0:
            label = (
                "estudio que presenta" if profile["outlierCount"] == 1 else "estudios que presentan"
            )
            drafts.append(
                {
                    "type": "outlier",
                    "titleTemplate": "Valores atípicos en {profileName}",
                    "descriptionTemplate": (
                        f"{{profileName}} contiene {profile['outlierCount']} {label} diferencias respecto al comportamiento habitual de estudios similares."
                    ),
                    "profileCluster": profile["cluster"],
                }
            )

    unknown_samples = len([row for row in rows if is_unknown_category(row["sampleType"])])
    unknown_methods = len([row for row in rows if is_unknown_category(row["analysisMethod"])])
    if unknown_samples / max(len(rows), 1) >= 0.25 or unknown_methods / max(len(rows), 1) >= 0.25:
        drafts.append(
            {
                "type": "data_quality",
                "titleTemplate": "Cobertura incompleta de variables categóricas",
                "descriptionTemplate": (
                    f"{unknown_samples} estudios no tienen tipo de muestra confirmado y {unknown_methods} no tienen método de análisis; "
                    "esos valores desconocidos se excluyeron de la interpretación."
                ),
            }
        )

    total_outliers = len([study for study in studies if study["isOutlier"]])
    if total_outliers > 0:
        label = "estudio presenta" if total_outliers == 1 else "estudios presentan"
        drafts.append(
            {
                "type": "outlier",
                "titleTemplate": "Revisión general de estudios atípicos",
                "descriptionTemplate": (
                    f"{total_outliers} {label} diferencias respecto al comportamiento habitual de estudios similares; conviene revisarlos."
                ),
            }
        )

    if not drafts and profiles:
        largest = sorted(
            profiles,
            key=lambda profile: profile["averages"]["requestCount"],
            reverse=True,
        )[0]
        drafts.append(
            {
                "type": "observation",
                "titleTemplate": "Distribución operativa estable",
                "descriptionTemplate": (
                    f"No se detectaron alertas fuertes; {{profileName}} presenta la mayor demanda promedio del análisis con {largest['averages']['requestCount']} solicitudes."
                ),
                "profileCluster": largest["cluster"],
            }
        )

    return [
        {
            "findingId": f"finding-{index + 1}",
            **finding,
        }
        for index, finding in enumerate(drafts[:12])
    ]


def build_result(
    rows: list[dict[str, Any]],
    fitted: dict[str, Any],
    feature_names: set[str],
) -> dict[str, Any]:
    raw_clusters = [
        [index for index, label in enumerate(fitted["labels"]) if label == cluster]
        for cluster in range(len(fitted["centroids"]))
    ]
    interpretation_thresholds = numeric_distributions(rows)
    ordered_clusters = sorted(
        [
            {
                "rawCluster": cluster_index,
                "indices": indices,
                "averages": averages([rows[index] for index in indices]),
            }
            for cluster_index, indices in enumerate(raw_clusters)
        ],
        key=lambda cluster: (
            cluster["averages"]["price"],
            cluster["averages"]["deliveryHours"],
        ),
    )
    cluster_id_map = {
        cluster["rawCluster"]: index + 1 for index, cluster in enumerate(ordered_clusters)
    }
    thresholds: dict[int, float] = {}
    for cluster in ordered_clusters:
        distances = sorted(fitted["distances"][index] for index in cluster["indices"])
        threshold = math.inf
        if len(distances) >= 5:
            q1 = quantile(distances, 0.25)
            q3 = quantile(distances, 0.75)
            iqr = q3 - q1
            if iqr > 0:
                threshold = q3 + 1.5 * iqr
            else:
                mean = float(np.mean(distances))
                deviation = float(np.std(distances))
                threshold = mean + 2 * deviation
        thresholds[cluster["rawCluster"]] = threshold

    studies = []
    for index, row in enumerate(rows):
        raw_cluster = fitted["labels"][index]
        threshold = thresholds[raw_cluster]
        distance = float(fitted["distances"][index])
        studies.append(
            {
                "studyId": row["studyId"],
                "code": row["code"],
                "name": row["name"],
                "cluster": cluster_id_map[raw_cluster],
                "distanceToCentroid": round_value(distance, 4),
                "outlierScore": round_value(distance / threshold, 3)
                if math.isfinite(threshold) and threshold > 0
                else 0,
                "isOutlier": bool(math.isfinite(threshold) and distance > threshold),
                "isSynthetic": row["isSynthetic"],
                "values": {
                    "price": row["price"],
                    "deliveryHours": row["deliveryHours"],
                    "parameterCount": row["parameterCount"],
                    "requestCount": row["requestCount"],
                    "sampleType": row["sampleType"],
                    "analysisMethod": row["analysisMethod"],
                    "requiresSpecialProcessing": row["requiresSpecialProcessing"],
                },
            }
        )

    profiles_with_qualifiers = []
    for index, cluster in enumerate(ordered_clusters):
        cluster_number = index + 1
        cluster_rows = [rows[row_index] for row_index in cluster["indices"]]
        cluster_studies = [study for study in studies if study["cluster"] == cluster_number]
        special_processing_percentage = round_value(
            (
                len([row for row in cluster_rows if row["requiresSpecialProcessing"]])
                / max(len(cluster_rows), 1)
            )
            * 100,
            1,
        )
        sample_types = category_summary([row["sampleType"] for row in cluster_rows])
        analysis_methods = category_summary([row["analysisMethod"] for row in cluster_rows])
        predominant_sample_type = (
            predominant_category([row["sampleType"] for row in cluster_rows])
            if has_category_feature(feature_names, "sample_type=")
            else None
        )
        predominant_method = (
            predominant_category([row["analysisMethod"] for row in cluster_rows])
            if has_category_feature(feature_names, "analysis_method=")
            else None
        )
        outlier_count = len([study for study in cluster_studies if study["isOutlier"]])
        interpretation = interpret_profile(
            cluster["averages"],
            interpretation_thresholds,
            feature_names,
            len(cluster_rows),
            outlier_count,
            special_processing_percentage,
            predominant_method,
            predominant_sample_type,
        )
        profiles_with_qualifiers.append(
            {
                "cluster": cluster_number,
                "suggestedName": interpretation["suggestedName"],
                "shortDescription": interpretation["shortDescription"],
                "keyCharacteristics": interpretation["keyCharacteristics"],
                "suggestedAction": interpretation["suggestedAction"],
                "nameQualifiers": interpretation["nameQualifiers"],
                "studyCount": len(cluster_rows),
                "percentage": round_value((len(cluster_rows) / max(len(rows), 1)) * 100, 1),
                "outlierCount": outlier_count,
                "outlierThreshold": round_value(thresholds[cluster["rawCluster"]], 4)
                if math.isfinite(thresholds[cluster["rawCluster"]])
                else None,
                "averages": {
                    "price": round_value(cluster["averages"]["price"], 2),
                    "deliveryHours": round_value(cluster["averages"]["deliveryHours"], 2),
                    "parameterCount": round_value(cluster["averages"]["parameterCount"], 2),
                    "requestCount": round_value(cluster["averages"]["requestCount"], 2),
                },
                "predominantMethod": predominant_method,
                "predominantSampleType": predominant_sample_type,
                "specialProcessingPercentage": special_processing_percentage,
                "sampleTypes": sample_types,
                "analysisMethods": analysis_methods,
                "traits": interpretation["traits"],
            }
        )

    profiles = [
        {key: value for key, value in profile.items() if key != "nameQualifiers"}
        for profile in resolve_suggested_name_collisions(profiles_with_qualifiers)
    ]
    findings = build_findings(profiles, studies, rows)
    cluster_artifacts = [
        {
            "cluster": index + 1,
            "centroid": [round_value(value, 10) for value in fitted["centroids"][cluster["rawCluster"]]],
            "outlierThreshold": round_value(thresholds[cluster["rawCluster"]], 10)
            if math.isfinite(thresholds[cluster["rawCluster"]])
            else None,
        }
        for index, cluster in enumerate(ordered_clusters)
    ]

    return {
        "profiles": profiles,
        "studies": studies,
        "findings": findings,
        "clusterArtifacts": cluster_artifacts,
        "interpretationThresholds": round_distributions(interpretation_thresholds),
    }


def enrich_artifact(
    artifact: dict[str, Any],
    dataset: list[dict[str, Any]],
    period_start: str,
    period_end: str,
    period_months: int,
) -> dict[str, Any]:
    synthetic_rows = len([row for row in dataset if row.get("isSynthetic") is True])
    total_request_count = sum(int(row.get("requestCount") or 0) for row in dataset)
    synthetic_request_count = sum(
        int(row.get("syntheticRequestCount") or 0) for row in dataset
    )
    fingerprint_payload = [
        {
            "studyId": row["studyId"],
            "code": row["code"],
            "name": row["name"],
            "price": row["price"],
            "deliveryHours": row["deliveryHours"],
            "parameterCount": row["parameterCount"],
            "requestCount": row["requestCount"],
            "syntheticRequestCount": row.get("syntheticRequestCount", 0),
            "sampleType": row["sampleType"],
            "analysisMethod": row["analysisMethod"],
            "requiresSpecialProcessing": row["requiresSpecialProcessing"],
            "isSynthetic": row["isSynthetic"],
        }
        for row in sorted(dataset, key=lambda row: row["studyId"])
    ]
    import hashlib

    fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return {
        **artifact,
        "generatedAt": period_end,
        "trainingPeriod": {
            "start": period_start,
            "end": period_end,
            "months": period_months,
        },
        "datasetFingerprintSha256": fingerprint,
        "datasetComposition": {
            "totalRows": len(dataset),
            "realRows": len(dataset) - synthetic_rows,
            "syntheticRows": synthetic_rows,
            "syntheticPercentage": round_value((synthetic_rows / max(len(dataset), 1)) * 100, 2),
            "totalRequestCount": total_request_count,
            "syntheticRequestCount": synthetic_request_count,
            "syntheticRequestPercentage": round_value(
                (synthetic_request_count / max(total_request_count, 1)) * 100,
                2,
            ),
        },
    }


def analyze_rows(rows: list[dict[str, Any]], options: dict[str, Any] | None = None) -> dict[str, Any]:
    options = options or {}
    prepared = prepare_rows(rows)
    clean_rows = prepared.rows
    if len(clean_rows) < 10:
        raise ValueError("Se necesitan al menos 10 estudios utilizables para ejecutar el clustering.")

    encoded = encode_and_scale(clean_rows)
    unique_vector_count = len(
        {
            "|".join(f"{value:.8f}" for value in vector)
            for vector in encoded["vectors"]
        }
    )
    max_k = min(max(int(options.get("maxK", 6)), 2), 6, len(clean_rows) - 1, unique_vector_count)
    if max_k < 2:
        raise ValueError("Los estudios no tienen suficiente variacion para formar clusters.")

    raw_evaluations = []
    fitted_by_k = {}
    minimum_stable_cluster_size = max(2, math.ceil(len(clean_rows) * 0.02))
    vectors = np.asarray(encoded["vectors"], dtype=float)

    for k in range(2, max_k + 1):
        fitted = fit_best(encoded["vectors"], k)
        fitted_by_k[k] = fitted
        labels = np.asarray(fitted["labels"])
        cluster_sizes = [int(np.sum(labels == index)) for index in range(k)]
        minimum_cluster_size = min(cluster_sizes)
        silhouette = float(silhouette_score(vectors, labels)) if len(set(fitted["labels"])) > 1 else 0.0
        davies_bouldin = float(davies_bouldin_score(vectors, labels)) if len(set(fitted["labels"])) > 1 else 0.0
        raw_evaluations.append(
            {
                "k": k,
                "inertia": fitted["inertia"],
                "silhouette": silhouette,
                "daviesBouldin": davies_bouldin,
                "iterations": fitted["iterations"],
                "minimumClusterSize": minimum_cluster_size,
                "stableForAutomaticSelection": minimum_cluster_size >= minimum_stable_cluster_size,
            }
        )

    elbow_k = find_elbow(raw_evaluations)
    stable_evaluations = [item for item in raw_evaluations if item["stableForAutomaticSelection"]]
    automatic_k = sorted(
        stable_evaluations if stable_evaluations else raw_evaluations,
        key=lambda item: (-item["silhouette"], item["daviesBouldin"], item["k"]),
    )[0]["k"]
    selected_k = int(options.get("requestedK") or automatic_k)
    if selected_k not in fitted_by_k:
        raise ValueError(f"El numero de clusters debe estar entre 2 y {max_k}.")

    selected = fitted_by_k[selected_k]
    result = build_result(clean_rows, selected, set(encoded["featureNames"]))
    artifact = {
        "artifactType": "econolab-study-clustering",
        "schemaVersion": "1.0",
        "algorithm": "kmeans",
        "modelVersion": "2.1",
        "randomSeed": STUDY_CLUSTERING_RANDOM_SEED,
        "initialization": "deterministic_farthest_point_3_starts",
        "selectedK": selected_k,
        "featureNames": encoded["featureNames"],
        "displayOnlyFields": ["studyId", "code", "name"],
        "preprocessing": {
            "numeric": {
                "price": {
                    "median": prepared.medians["price"],
                    "lowerBound": encoded["lowerBounds"]["price"],
                    "upperBound": encoded["upperBounds"]["price"],
                    "mean": encoded["means"]["price"],
                    "standardDeviation": encoded["deviations"]["price"],
                },
                "deliveryHours": {
                    "median": prepared.medians["deliveryHours"],
                    "lowerBound": encoded["lowerBounds"]["deliveryHours"],
                    "upperBound": encoded["upperBounds"]["deliveryHours"],
                    "mean": encoded["means"]["deliveryHours"],
                    "standardDeviation": encoded["deviations"]["deliveryHours"],
                },
                "parameterCount": {
                    "median": prepared.medians["parameterCount"],
                    "lowerBound": encoded["lowerBounds"]["parameterCount"],
                    "upperBound": encoded["upperBounds"]["parameterCount"],
                    "mean": encoded["means"]["parameterCount"],
                    "standardDeviation": encoded["deviations"]["parameterCount"],
                },
                "requestCount": {
                    "median": prepared.medians["requestCount"],
                    "lowerBound": encoded["lowerBounds"]["requestCount"],
                    "upperBound": encoded["upperBounds"]["requestCount"],
                    "mean": encoded["means"]["requestCount"],
                    "standardDeviation": encoded["deviations"]["requestCount"],
                },
            },
            "sampleTypeCategories": encoded["sampleTypeCategories"],
            "analysisMethodCategories": encoded["analysisMethodCategories"],
            "requiresSpecialProcessingMode": prepared.requires_special_processing_mode,
        },
        "clusters": result["clusterArtifacts"],
    }

    warnings = [
        *prepared.warnings,
        *(
            [
                f"Los extremos numericos se limitaron a los percentiles {encoded['winsorizationPercentiles']['lower']} y {encoded['winsorizationPercentiles']['upper']} solo para evitar que dominaran K-Means; los valores originales se conservan en los resultados."
            ]
            if any(value > 0 for value in encoded["winsorizedValues"].values())
            else []
        ),
        *(
            [
                f"La seleccion automatica descarto valores de k con grupos menores a {minimum_stable_cluster_size} estudios para evitar clusters formados por casos aislados."
            ]
            if any(not item["stableForAutomaticSelection"] for item in raw_evaluations)
            else []
        ),
        *(
            [
                f"Se excluyeron variables constantes o con cobertura insuficiente: {', '.join(encoded['ignoredConstantFeatures'])}."
            ]
            if encoded["ignoredConstantFeatures"]
            else []
        ),
        *(
            [
                "request_count incluye demanda demostrativa ECO-ML; synthetic_request_count se conserva solo para auditoria y no entra como variable adicional."
            ]
            if any(int(row.get("syntheticRequestCount") or 0) > 0 for row in rows)
            else []
        ),
    ]

    return {
        "model": {
            "algorithm": "kmeans",
            "version": "2.1",
            "selectedK": selected_k,
            "elbowK": elbow_k,
            "selectionMethod": "requested_by_user"
            if options.get("requestedK")
            else "highest_silhouette",
            "silhouetteScore": round_value(
                next(item["silhouette"] for item in raw_evaluations if item["k"] == selected_k), 4
            ),
            "daviesBouldinScore": round_value(
                next(item["daviesBouldin"] for item in raw_evaluations if item["k"] == selected_k),
                4,
            ),
            "inertia": round_value(selected["inertia"], 2),
            "trainingSamples": len(clean_rows),
            "featureNames": encoded["featureNames"],
            "displayOnlyFields": ["studyId", "code", "name"],
        },
        "evaluations": [
            {
                "k": item["k"],
                "inertia": round_value(item["inertia"], 2),
                "silhouette": round_value(item["silhouette"], 4),
                "daviesBouldin": round_value(item["daviesBouldin"], 4),
                "iterations": item["iterations"],
                "minimumClusterSize": item["minimumClusterSize"],
                "stableForAutomaticSelection": item["stableForAutomaticSelection"],
                "isElbow": item["k"] == elbow_k,
                "isSelected": item["k"] == selected_k,
            }
            for item in raw_evaluations
        ],
        "profiles": result["profiles"],
        "studies": result["studies"],
        "findings": result["findings"],
        "artifact": artifact,
        "interpretationThresholds": result["interpretationThresholds"],
        "dataQuality": {
            "receivedRows": len(rows),
            "usableRows": len(clean_rows),
            "excludedRows": len(rows) - prepared.unique_rows,
            "duplicateRows": prepared.duplicate_rows,
            "imputedValues": prepared.imputed_values,
            "winsorizedValues": encoded["winsorizedValues"],
            "winsorizationPercentiles": encoded["winsorizationPercentiles"],
            "ignoredConstantFeatures": encoded["ignoredConstantFeatures"],
            "realRows": len([row for row in clean_rows if not row["isSynthetic"]]),
            "syntheticRows": len([row for row in clean_rows if row["isSynthetic"]]),
            "syntheticPercentage": round_value(
                (len([row for row in clean_rows if row["isSynthetic"]]) / max(len(clean_rows), 1))
                * 100,
                2,
            ),
            "syntheticDemandRows": len(
                [row for row in rows if int(row.get("syntheticRequestCount") or 0) > 0]
            ),
            "syntheticRequestCount": sum(int(row.get("syntheticRequestCount") or 0) for row in rows),
        },
        "warnings": warnings,
    }


def resolve_pickle_path(root: Path, requested: str | None = None) -> Path:
    if requested:
        candidate = Path(requested)
        return candidate if candidate.is_absolute() else root / candidate
    configured = os.environ.get("STUDY_CLUSTERING_MODEL_PKL_PATH", "").strip()
    if configured:
        candidate = Path(configured)
        return candidate if candidate.is_absolute() else root / candidate
    candidates = [
        root / "07_Modelos" / "clustering_estudios_model.pkl",
        root / "ml" / "clustering" / "artifacts" / "clustering_estudios_model.pkl",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def row_to_assignment(row: dict[str, Any], artifact: dict[str, Any]) -> dict[str, Any]:
    feature_values: dict[str, float] = {}
    feature_name_by_numeric_key = {
        "price": "price",
        "deliveryHours": "delivery_hours",
        "parameterCount": "parameter_count",
        "requestCount": "request_count",
    }
    for key in NUMERIC_FEATURES:
        config = artifact["preprocessing"]["numeric"][key]
        raw_value = row.get(key)
        valid = is_positive_number(raw_value) if key in {"price", "deliveryHours"} else is_non_negative_number(raw_value)
        value = float(raw_value) if valid else float(config["median"])
        clipped = min(float(config["upperBound"]), max(float(config["lowerBound"]), value))
        feature_values[feature_name_by_numeric_key[key]] = (
            (clipped - float(config["mean"])) / (float(config["standardDeviation"]) or 1.0)
        )

    def set_one_hot(prefix: str, raw_value: object, categories: list[str]) -> None:
        normalized = normalize_category(raw_value)
        mapped = None
        if not is_unknown_category(normalized):
            mapped = normalized if normalized in categories else ("otros" if "otros" in categories else None)
        for category in categories:
            feature_values[f"{prefix}={category}"] = 1.0 if mapped == category else 0.0

    set_one_hot("sample_type", row.get("sampleType"), artifact["preprocessing"]["sampleTypeCategories"])
    set_one_hot(
        "analysis_method",
        row.get("analysisMethod"),
        artifact["preprocessing"]["analysisMethodCategories"],
    )
    special_processing = (
        bool(row["requiresSpecialProcessing"])
        if isinstance(row.get("requiresSpecialProcessing"), bool)
        else bool(artifact["preprocessing"]["requiresSpecialProcessingMode"])
    )
    feature_values["requires_special_processing"] = 1.0 if special_processing else 0.0

    vector = np.asarray(
        [feature_values.get(feature_name, 0.0) for feature_name in artifact["featureNames"]],
        dtype=float,
    )
    ordered_clusters = sorted(
        artifact["clusters"],
        key=lambda cluster: (
            float(np.sum((vector - np.asarray(cluster["centroid"], dtype=float)) ** 2)),
            int(cluster["cluster"]),
        ),
    )
    selected = ordered_clusters[0]
    distance = math.sqrt(
        float(np.sum((vector - np.asarray(selected["centroid"], dtype=float)) ** 2))
    )
    threshold = selected.get("outlierThreshold")
    return {
        "cluster": int(selected["cluster"]),
        "distanceToCentroid": round_value(distance, 4),
        "isOutlier": bool(threshold is not None and distance > float(threshold)),
    }


def train_from_csv(root: Path | None = None) -> dict[str, Any]:
    root = root or project_root()
    dataset_path = root / "05_Datasets" / "clustering_estudios.csv"
    rows = pd.read_csv(dataset_path).fillna(value=np.nan).to_dict("records")
    normalized_rows = [
        {
            "studyId": int(row["study_id"]),
            "code": str(row.get("code") or ""),
            "name": str(row.get("name") or ""),
            "price": None if pd.isna(row.get("price")) else float(row.get("price")),
            "deliveryHours": None if pd.isna(row.get("delivery_hours")) else float(row.get("delivery_hours")),
            "parameterCount": None if pd.isna(row.get("parameter_count")) else float(row.get("parameter_count")),
            "requestCount": None if pd.isna(row.get("request_count")) else float(row.get("request_count")),
            "syntheticRequestCount": None
            if pd.isna(row.get("synthetic_request_count"))
            else float(row.get("synthetic_request_count")),
            "sampleType": None if pd.isna(row.get("sample_type")) else row.get("sample_type"),
            "analysisMethod": None if pd.isna(row.get("analysis_method")) else row.get("analysis_method"),
            "requiresSpecialProcessing": None
            if pd.isna(row.get("requires_special_processing"))
            else truthy(row.get("requires_special_processing")),
            "isSynthetic": truthy(row.get("is_synthetic")),
        }
        for row in rows
    ]
    result = analyze_rows(normalized_rows, {"maxK": 6})

    now_utc = pd.Timestamp.now(tz="UTC")
    period_end = now_utc.isoformat()
    period_start = (now_utc - pd.DateOffset(months=6)).isoformat()
    stored_artifact = enrich_artifact(
        result["artifact"],
        normalized_rows,
        period_start,
        period_end,
        6,
    )
    artifact_document = {
        **stored_artifact,
        "deployment": {"persisted": False},
        "evaluation": {
            "selectedK": result["model"]["selectedK"],
            "elbowK": result["model"]["elbowK"],
            "silhouetteScore": result["model"]["silhouetteScore"],
            "daviesBouldinScore": result["model"]["daviesBouldinScore"],
            "inertia": result["model"]["inertia"],
            "alternatives": result["evaluations"],
        },
        "profiles": result["profiles"],
        "dataQuality": result["dataQuality"],
        "warnings": result["warnings"],
        "sources": {
            "price": "operativo.studies.normalPrice",
            "deliveryHours": "operativo.studies.durationMinutes / 60",
            "parameterCount": "operativo.study_details",
            "requestCount": "operativo.service_order_items + operativo.service_orders",
            "syntheticRequestCount": "misma fuente; SUM(quantity) cuando folio LIKE 'ECO-ML-%' (solo auditoria)",
            "sampleType": "operativo.studies.sampleType",
            "analysisMethod": "operativo.studies.method",
            "requiresSpecialProcessing": "operativo.studies.requiresSpecialProcessing",
            "isSynthetic": "operativo.studies.code LIKE 'ECN-CAT-%' (solo auditoria; no entra al modelo)",
        },
    }
    metadata_document = {
        "generatedAt": period_end,
        "periodStart": period_start,
        "periodEnd": period_end,
        "periodMonths": 6,
        "unitOfAnalysis": "Un estudio individual activo del catalogo ECONOLAB",
        "datasetFingerprintSha256": stored_artifact["datasetFingerprintSha256"],
        "composition": stored_artifact["datasetComposition"],
        "sources": artifact_document["sources"],
        "exclusions": [
            "Paquetes, estudios inactivos o suspendidos",
            "MLTRAIN y registros marcados como DATOS SINTETICOS",
            "Ordenes canceladas para calcular request_count",
        ],
    }

    backend_models = root / "07_Modelos"
    ml_root = root / "ml" / "clustering"
    artifact_json_path = backend_models / "clustering_estudios_model.json"
    artifact_pickle_path = backend_models / "clustering_estudios_model.pkl"
    metadata_path = root / "05_Datasets" / "clustering_estudios_metadata.json"
    assignments_path = root / "05_Datasets" / "clustering_estudios_asignaciones.csv"
    ml_artifact_json_path = ml_root / "artifacts" / "clustering_estudios_model.json"
    ml_artifact_pickle_path = ml_root / "artifacts" / "clustering_estudios_model.pkl"
    ml_metadata_path = ml_root / "reports" / "clustering_estudios_metadata.json"
    ml_assignments_path = ml_root / "reports" / "clustering_estudios_asignaciones.csv"

    for directory in [
        backend_models,
        root / "05_Datasets",
        ml_root / "artifacts",
        ml_root / "data",
        ml_root / "reports",
    ]:
        directory.mkdir(parents=True, exist_ok=True)

    write_json(artifact_json_path, artifact_document)
    write_json(ml_artifact_json_path, artifact_document)
    with artifact_pickle_path.open("wb") as handler:
        pickle.dump({"artifact": stored_artifact}, handler)
    with ml_artifact_pickle_path.open("wb") as handler:
        pickle.dump({"artifact": stored_artifact}, handler)
    write_json(metadata_path, metadata_document)
    write_json(ml_metadata_path, metadata_document)
    pd.DataFrame(
        [
            {
                "study_id": study["studyId"],
                "code": study["code"],
                "name": study["name"],
                "cluster": study["cluster"],
                "distance_to_centroid": study["distanceToCentroid"],
                "outlier_score": study["outlierScore"],
                "is_outlier": study["isOutlier"],
                "is_synthetic": study["isSynthetic"],
                "price": study["values"]["price"],
                "delivery_hours": study["values"]["deliveryHours"],
                "parameter_count": study["values"]["parameterCount"],
                "request_count": study["values"]["requestCount"],
                "sample_type": study["values"]["sampleType"],
                "analysis_method": study["values"]["analysisMethod"],
                "requires_special_processing": study["values"]["requiresSpecialProcessing"],
            }
            for study in result["studies"]
        ]
    ).to_csv(assignments_path, index=False)
    pd.DataFrame(
        [
            {
                "study_id": study["studyId"],
                "code": study["code"],
                "name": study["name"],
                "cluster": study["cluster"],
                "distance_to_centroid": study["distanceToCentroid"],
                "outlier_score": study["outlierScore"],
                "is_outlier": study["isOutlier"],
                "is_synthetic": study["isSynthetic"],
                "price": study["values"]["price"],
                "delivery_hours": study["values"]["deliveryHours"],
                "parameter_count": study["values"]["parameterCount"],
                "request_count": study["values"]["requestCount"],
                "sample_type": study["values"]["sampleType"],
                "analysis_method": study["values"]["analysisMethod"],
                "requires_special_processing": study["values"]["requiresSpecialProcessing"],
            }
            for study in result["studies"]
        ]
    ).to_csv(ml_assignments_path, index=False)

    return {
        "dataset": str(dataset_path),
        "artifactJson": str(artifact_json_path),
        "artifactPkl": str(artifact_pickle_path),
        "metadata": str(metadata_path),
        "assignments": str(assignments_path),
        "rows": len(normalized_rows),
        "selectedK": result["model"]["selectedK"],
        "silhouette": result["model"]["silhouetteScore"],
        "daviesBouldin": result["model"]["daviesBouldinScore"],
    }


def assign_with_exported_model(payload: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    root = root or project_root()
    pickle_path = resolve_pickle_path(root, payload.get("modelPath"))
    if not pickle_path.exists():
        raise FileNotFoundError(f"The clustering .pkl model does not exist: {pickle_path}")
    with pickle_path.open("rb") as handler:
        bundle = pickle.load(handler)
    artifact = bundle["artifact"]
    rows = payload.get("rows") or []
    return {
        "assignments": [
            row_to_assignment(row, artifact)
            for row in rows
        ]
    }


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "train"
    if command in {"train", "train_csv"}:
        print(json.dumps(train_from_csv(), ensure_ascii=False, indent=2))
        return
    if command == "analyze":
        payload = read_json_stdin()
        result = analyze_rows(payload.get("rows") or [], payload.get("options") or {})
        print(json.dumps(result, ensure_ascii=False))
        return
    if command == "assign":
        result = assign_with_exported_model(read_json_stdin())
        print(json.dumps(result, ensure_ascii=False))
        return
    raise SystemExit(f"Unsupported command: {command}")


if __name__ == "__main__":
    main()
