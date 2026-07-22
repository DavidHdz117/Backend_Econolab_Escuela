"""Construye la libreta reproducible de clasificación de ECONOLAB."""

from pathlib import Path

import nbformat as nbf


PROJECT = Path(__file__).resolve().parents[3]
OUTPUT = PROJECT / "06_Notebooks" / "03_clasificacion_resultado_servicio.ipynb"


def markdown(source: str):
    return nbf.v4.new_markdown_cell(source.strip())


def code(source: str):
    return nbf.v4.new_code_cell(source.strip())


cells = [
    markdown(
        r"""
# 03 · Clasificación del resultado de un servicio

## Fase 1 CRISP-DM — Comprensión del negocio

La unidad de análisis es **una orden histórica**. El objetivo `outcome` tiene
tres clases: `completed_on_time`, `delayed` y `cancelled`. El modelo usa solo
datos disponibles al registrar el servicio para apoyar la planeación operativa;
no cambia el estado de la orden ni toma decisiones clínicas.

El error más costoso es pronosticar *a tiempo* cuando el servicio terminará
retrasado o cancelado, porque evita anticipar carga y avisar al paciente. Se usa
regresión logística multinomial: convierte puntajes lineales a probabilidades
con softmax y minimiza entropía cruzada ponderada con regularización L2. Es un
modelo apropiado para tres clases e interpretable, aunque requiere vigilar
calibración, deriva y el alto porcentaje de datos sintéticos.

Referencias: Hosmer, Lemeshow y Sturdivant (2013), *Applied Logistic
Regression*; Hastie, Tibshirani y Friedman (2009), *The Elements of Statistical
Learning*.
"""
    ),
    code(
        r"""
from pathlib import Path
import hashlib, json, math, os, subprocess, unicodedata
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from IPython.display import display

RED, BLACK, GRAY, WHITE = '#C8102E', '#111111', '#777777', '#FFFFFF'
plt.rcParams.update({'figure.facecolor': WHITE, 'axes.facecolor': WHITE,
                     'font.size': 10, 'axes.titleweight': 'bold'})

candidates = [Path.cwd(), *Path.cwd().parents]
BACKEND = next((p for p in candidates if (p / 'ml' / 'classification').exists()), None)
if BACKEND is None:
    PROJECT = next(p for p in candidates if (p / 'backend' / 'ml' / 'classification').exists())
    BACKEND = PROJECT / 'backend'
else:
    PROJECT = BACKEND.parent

# Ejecuta BD -> limpieza -> CSV -> train temporal -> evaluación -> artefacto.
npm = 'npm.cmd' if os.name == 'nt' else 'npm'
training = subprocess.run([npm, 'run', 'classification:train'], cwd=BACKEND,
                          check=True, capture_output=True, text=True)
print(training.stdout)

ML = BACKEND / 'ml' / 'classification'
EVIDENCE = PROJECT / '09_Evidencias'
EVIDENCE.mkdir(exist_ok=True)
CSV = ML / 'data' / 'classification_service_outcomes.csv'
TRAIN_CSV = ML / 'data' / 'classification_service_outcomes_train.csv'
TEST_CSV = ML / 'data' / 'classification_service_outcomes_test.csv'
ARTIFACT = ML / 'artifacts' / 'classification_service_outcome_model.json'
REPORT = ML / 'reports' / 'classification_training_report.json'

df = pd.read_csv(CSV, parse_dates=['source_created_at', 'source_updated_at'])
train_df = pd.read_csv(TRAIN_CSV, parse_dates=['source_created_at', 'source_updated_at'])
test_df = pd.read_csv(TEST_CSV, parse_dates=['source_created_at', 'source_updated_at'])
artifact = json.loads(ARTIFACT.read_text(encoding='utf-8'))
report = json.loads(REPORT.read_text(encoding='utf-8'))
csv_hash = hashlib.sha256(CSV.read_bytes()).hexdigest()
assert csv_hash == artifact['datasetSha256'] == report['datasetSha256']
assert set(train_df.order_id).isdisjoint(set(test_df.order_id))
assert train_df.source_created_at.max() <= test_df.source_created_at.min()

split = report['evaluationSplit']
print(f'Dataset verificado: {df.shape[0]} filas × {df.shape[1]} columnas')
print(f'SHA-256: {csv_hash}')
print(f"Validación: {split['strategy']} por {split['orderingField']}")
print(f"Periodo elegible: {split['eligiblePeriod']['start']} a {split['eligiblePeriod']['end']}")
"""
    ),
    markdown(
        r"""
## Fase 2 CRISP-DM — Comprensión de los datos

El SQL versionado extrae una fila por orden. ID, folio, fechas y procedencia se
conservan para auditoría, pero nunca se entregan como X. Se revisan dimensiones,
tipos, nulos, cardinalidad, baja variabilidad y valores extremos con regla IQR.
"""
    ),
    code(
        r"""
display(pd.DataFrame({
    'concepto': ['Filas extraídas', 'Filas aceptadas', 'Filas rechazadas',
                 'Duplicados', 'Filas sintéticas', 'Filas reales'],
    'valor': [report['quality']['rowsExtracted'], report['quality']['rowsAccepted'],
              report['quality']['rowsRejected'], report['quality']['duplicateOrderIds'],
              report['quality']['syntheticRows'], report['quality']['realRows']]
}))
display(df.head(5))
quality = pd.DataFrame({'tipo': df.dtypes.astype(str),
                        'nulos': df.isna().sum(),
                        'porcentaje_nulos': (df.isna().mean() * 100).round(2)})
display(quality)
print('X usadas:', ', '.join(report['traceability']['predictorsX']))
print('Solo auditoría:', ', '.join(report['traceability']['auditOnlyNotUsedAsX']))
"""
    ),
    code(
        r"""
numeric_eda = pd.DataFrame(report['exploratoryAnalysisX']['numeric']).T
categorical_eda = pd.DataFrame(report['exploratoryAnalysisX']['categorical']).T
display(numeric_eda[['nonNullCount', 'uniqueCount', 'dominantValueProportion',
                     'mean', 'standardDeviation', 'minimum', 'q1', 'median',
                     'q3', 'maximum', 'iqrOutlierCount', 'lowVariability']])
display(categorical_eda[['nullCount', 'cardinality',
                         'dominantValueProportion', 'lowVariability']])
"""
    ),
    code(
        r"""
classes = list(artifact['model']['classes'])
labels = {'completed_on_time': 'A tiempo', 'delayed': 'Retrasado',
          'cancelled': 'Cancelado'}
fig, axes = plt.subplots(2, 2, figsize=(12, 8))

axes[0, 0].boxplot([df.loc[df.outcome.eq(c), 'promised_lead_hours'] for c in classes],
                   tick_labels=[labels[c] for c in classes], patch_artist=True,
                   boxprops={'facecolor': '#F7DDE3', 'color': RED},
                   medianprops={'color': BLACK})
axes[0, 0].set_title('Tiempo prometido por resultado')
axes[0, 0].set_ylabel('Horas')

axes[0, 1].boxplot([df.loc[df.outcome.eq(c), 'total_amount'] for c in classes],
                   tick_labels=[labels[c] for c in classes], patch_artist=True,
                   boxprops={'facecolor': '#F7DDE3', 'color': RED},
                   medianprops={'color': BLACK})
axes[0, 1].set_title('Importe total por resultado')
axes[0, 1].set_ylabel('Importe')

dominance = numeric_eda.dominantValueProportion.astype(float).sort_values()
dominance.plot.barh(ax=axes[1, 0],
                    color=[RED if v >= .99 else BLACK for v in dominance],
                    label='Proporción dominante')
axes[1, 0].axvline(.99, color=RED, linestyle='--', label='Umbral de exclusión')
axes[1, 0].set_title('Proporción del valor dominante')
axes[1, 0].set_xlabel('Proporción'); axes[1, 0].legend(loc='lower right')

outliers = numeric_eda.iqrOutlierCount.astype(int).sort_values()
outliers.plot.barh(ax=axes[1, 1], color=RED)
axes[1, 1].set_title('Valores extremos detectados por IQR')
axes[1, 1].set_xlabel('Filas')

fig.suptitle('EDA de variables X · clasificación ECONOLAB', fontsize=15, color=BLACK)
plt.tight_layout()
eda_path = EVIDENCE / 'clasificacion_eda_variables_x.png'
plt.savefig(eda_path, dpi=180, bbox_inches='tight', facecolor=WHITE)
plt.show()
print('Evidencia:', eda_path.relative_to(PROJECT).as_posix())
"""
    ),
    markdown(
        r"""
### Hallazgo y decisión del EDA

`package_component_count` tiene 99.61 % de ceros y solo dos observaciones no
cero: se conserva en el CSV para trazabilidad, pero el preprocesamiento ajustado
con train la excluye del artefacto por baja variabilidad. Las demás X candidatas
mantienen variación. Los extremos IQR válidos de hora de registro y descuento se
conservan porque pasan las reglas de negocio; se vigilarán como posible deriva.
Los conteos de ítems son muy correlacionados en los datos sintéticos, pero se
mantienen por su significado operativo distinto y la regularización L2 reduce
la inestabilidad; deberán reevaluarse con más historial real.
"""
    ),
    markdown(
        r"""
## Fase 3 CRISP-DM — Preparación de los datos

Se rechazan objetivos no disponibles, IDs duplicados, fechas inválidas,
intervalos no positivos e importes inconsistentes. El 20 % más reciente se
reserva como test **antes** de aprender imputación, medias, desviaciones,
categorías one-hot y pesos de clase. El artefacto desplegado es exactamente el
clasificador ajustado con train; no se reentrena con test.
"""
    ),
    code(
        r"""
split_table = pd.DataFrame({
    'periodo': ['Elegible', 'Train (pasado)', 'Test (futuro)'],
    'inicio': [split['eligiblePeriod']['start'], split['trainingPeriod']['start'],
               split['testPeriod']['start']],
    'fin': [split['eligiblePeriod']['end'], split['trainingPeriod']['end'],
            split['testPeriod']['end']],
    'filas': [len(df), len(train_df), len(test_df)]
})
display(split_table)
display(pd.DataFrame({'train': split['trainingClassDistribution'],
                      'test': split['testClassDistribution']}))
print('Traslape de IDs:', split['overlapCount'])
print('Train termina antes de iniciar test:', split['trainEndsBeforeTestStarts'])

counts = pd.DataFrame({'Train': train_df.outcome.value_counts(),
                       'Test': test_df.outcome.value_counts()}).reindex(classes).fillna(0)
fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
counts.rename(index=labels).plot.bar(ax=axes[0], color=[BLACK, RED])
axes[0].set_title('Las tres clases están en ambos periodos')
axes[0].set_xlabel('Clase'); axes[0].set_ylabel('Órdenes'); axes[0].tick_params(axis='x', rotation=0)

periods = [('Train', train_df.source_created_at.min(), train_df.source_created_at.max(), BLACK),
           ('Test', test_df.source_created_at.min(), test_df.source_created_at.max(), RED)]
for y, (name, start, end, color) in enumerate(periods):
    axes[1].plot([start, end], [y, y], linewidth=10, color=color, solid_capstyle='round')
axes[1].set_yticks([0, 1], ['Train', 'Test'])
axes[1].set_title('Separación cronológica sin mezcla futura')
axes[1].set_xlabel('Fecha de creación de la orden')
axes[1].xaxis.set_major_locator(mdates.MonthLocator(interval=2))
axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
axes[1].tick_params(axis='x', rotation=20)
axes[1].grid(axis='x', alpha=.2)
fig.suptitle('Holdout temporal · clasificación ECONOLAB', fontsize=15)
plt.tight_layout()
balance_path = EVIDENCE / 'clasificacion_balance_periodos.png'
plt.savefig(balance_path, dpi=180, bbox_inches='tight', facecolor=WHITE)
plt.show()
print('Evidencia:', balance_path.relative_to(PROJECT).as_posix())
"""
    ),
    markdown(
        r"""
## Fase 4 CRISP-DM — Modelado

Se entrena regresión logística multinomial con pesos inversos por clase,
regularización L2 y parada temprana. Las transformaciones y los pesos se ajustan
solo con las 410 órdenes del pasado. El JSON conserva las medias, desviaciones,
categorías y coeficientes exactos que carga NestJS.

## Fase 5 CRISP-DM — Evaluación

Se comparan accuracy y macro F1 contra un baseline que siempre predice la clase
mayoritaria de train. También se reportan precision, recall y F1 por clase y la
matriz de confusión del periodo futuro.
"""
    ),
    code(
        r"""
evaluation = artifact['evaluation']
metrics = pd.DataFrame(evaluation['metricsByClass']).T
display(metrics.rename(columns={'f1Score': 'f1'}))
comparison = pd.DataFrame({
    'modelo': ['Clasificador temporal', 'Baseline mayoritario'],
    'accuracy': [evaluation['accuracy'], evaluation['baseline']['accuracy']],
    'macro_f1': [evaluation['macroAverage']['f1Score'],
                 evaluation['baseline']['macroAverage']['f1Score']]
})
display(comparison)
print('Pesos aprendidos con train:', artifact['dataset']['classWeights'])
"""
    ),
    code(
        r"""
matrix = pd.DataFrame(evaluation['confusionMatrix']).T.reindex(index=classes, columns=classes)
fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
axes[0].imshow(matrix.values, cmap='Reds', vmin=0, vmax=matrix.values.max())
for i in range(len(classes)):
    for j in range(len(classes)):
        axes[0].text(j, i, int(matrix.iloc[i, j]), ha='center', va='center',
                     color=WHITE if matrix.iloc[i, j] > matrix.values.max()/2 else BLACK,
                     fontweight='bold')
axes[0].set_xticks(range(3), [labels[c] for c in classes], rotation=20, ha='right')
axes[0].set_yticks(range(3), [labels[c] for c in classes])
axes[0].set_xlabel('Predicha'); axes[0].set_ylabel('Real')
axes[0].set_title('Matriz de confusión · test futuro')

x = range(2); width = .34
axes[1].bar([i-width/2 for i in x], comparison.accuracy, width, label='Accuracy', color=RED)
axes[1].bar([i+width/2 for i in x], comparison.macro_f1, width, label='Macro F1', color=BLACK)
axes[1].set_xticks(list(x), ['Clasificador', 'Baseline'])
axes[1].set_ylim(0, 1); axes[1].set_ylabel('Métrica')
axes[1].set_title('Modelo contra baseline')
axes[1].legend()
for container in axes[1].containers:
    axes[1].bar_label(container, fmt='%.3f', padding=3)
fig.suptitle('Evaluación temporal · clasificación ECONOLAB', fontsize=15)
plt.tight_layout()
matrix_path = EVIDENCE / 'clasificacion_matriz_confusion.png'
plt.savefig(matrix_path, dpi=180, bbox_inches='tight', facecolor=WHITE)
plt.show()
print('Evidencia:', matrix_path.relative_to(PROJECT).as_posix())
"""
    ),
    markdown(
        r"""
### Interpretación de errores

El modelo mejora al baseline en accuracy y macro F1. La prioridad operativa es
revisar los servicios `delayed` pronosticados como `completed_on_time`, porque
son retrasos que no activarían una alerta. La clase cancelada tiene menos casos;
su recall debe leerse junto con precision y soporte, no de forma aislada.
"""
    ),
    markdown(
        r"""
## Fase 6 CRISP-DM — Despliegue e inferencia

La función siguiente replica el backend: aplica el preprocesamiento y los pesos
del JSON exacto sin consultar Y y sin volver a entrenar.
"""
    ),
    code(
        r"""
camel_to_csv = {
 'promisedLeadHours':'promised_lead_hours', 'registrationHour':'registration_hour',
 'registrationWeekday':'registration_weekday', 'itemCount':'item_count',
 'totalQuantity':'total_quantity', 'distinctStudyCount':'distinct_study_count',
 'packageComponentCount':'package_component_count', 'subtotalAmount':'subtotal_amount',
 'courtesyPercent':'courtesy_percent', 'discountAmount':'discount_amount',
 'totalAmount':'total_amount', 'branchName':'branch_name',
 'dominantPriceType':'dominant_price_type'
}
def normalize_category(value):
    if pd.isna(value): return '__missing__'
    text = ''.join(c for c in unicodedata.normalize('NFD', str(value))
                   if unicodedata.category(c) != 'Mn')
    return ' '.join(text.strip().lower().split()) or '__missing__'

def predict_artifact(row):
    vector = [1.0]
    for feature in artifact['preprocessing']['numeric']:
        value = row.get(camel_to_csv[feature['key']], feature['mean'])
        value = feature['mean'] if pd.isna(value) else float(value)
        vector.append((value-feature['mean'])/feature['standardDeviation'])
    for feature in artifact['preprocessing']['categorical']:
        value = normalize_category(row.get(camel_to_csv[feature['key']]))
        value = value if value in feature['categories'] else '__other__'
        vector.extend(1.0 if value == category else 0.0
                      for category in feature['categories'])
    scores = [sum(x*w for x,w in zip(vector, weights))
              for weights in artifact['classifier']['weights']]
    maximum = max(scores); exp = [math.exp(score-maximum) for score in scores]
    probabilities = [value/sum(exp) for value in exp]
    return classes[probabilities.index(max(probabilities))], probabilities

cases = test_df.groupby('outcome', group_keys=False).head(1).copy()
predictions = cases.apply(predict_artifact, axis=1)
cases['predicted'] = [value[0] for value in predictions]
for index, name in enumerate(classes):
    cases[f'p_{name}'] = [value[1][index] for value in predictions]
display(cases[['source_folio', 'source_created_at', 'is_synthetic', 'outcome',
               'predicted', *[f'p_{name}' for name in classes]]])
"""
    ),
    markdown(
        r"""
## Conclusión

El artefacto evaluado y desplegado aprende únicamente del periodo pasado,
supera el baseline y conserva evidencia por clase. El 97.66 % sintético permite
demostrar el pipeline, pero no acredita desempeño productivo: debe revalidarse
con más historial real, por sucursal y por periodo, antes de automatizar alertas.
"""
    ),
]

notebook = nbf.v4.new_notebook(
    cells=cells,
    metadata={
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3",
        },
        "language_info": {"name": "python", "version": "3"},
    },
)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
nbf.write(notebook, OUTPUT)
print(OUTPUT)
