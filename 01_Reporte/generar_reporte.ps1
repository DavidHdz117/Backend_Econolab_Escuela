[CmdletBinding()]
param(
  [string]$Grupo = 'PENDIENTE',
  [string]$Equipo = 'PENDIENTE',
  [string]$Integrante1 = 'PENDIENTE',
  [string]$Matricula1 = 'PENDIENTE',
  [string]$Integrante2 = 'PENDIENTE',
  [string]$Matricula2 = 'PENDIENTE',
  [string]$Fecha = '21 de julio de 2026'
)

$ErrorActionPreference = 'Stop'
$reportRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $reportRoot '..')).Path
$templatePath = Join-Path $reportRoot 'Reporte_Practico_ECONOLAB.html'
$converterPath = Join-Path $reportRoot 'html_a_docx.py'
$temporaryHtmlPath = Join-Path $reportRoot (
  '.reporte-' + [Guid]::NewGuid().ToString('N') + '.html'
)
$temporaryBrowserProfile = Join-Path $reportRoot (
  '.browser-' + [Guid]::NewGuid().ToString('N')
)
$docxPath = Join-Path $reportRoot 'Reporte_Practico_ECONOLAB.docx'
$pdfPath = Join-Path $reportRoot 'Reporte_Practico_ECONOLAB.pdf'

function ConvertTo-HtmlText {
  param([AllowNull()]$Value)
  if ($null -eq $Value) { return 'N/D' }
  return [Net.WebUtility]::HtmlEncode([string]$Value)
}

function Format-Number {
  param(
    [AllowNull()]$Value,
    [int]$Decimals = 4
  )
  if ($null -eq $Value) { return 'N/D' }
  return ([double]$Value).ToString(
    "F$Decimals",
    [Globalization.CultureInfo]::InvariantCulture
  )
}

function Read-Json {
  param([Parameter(Mandatory)][string]$RelativePath)
  $path = Join-Path $projectRoot $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Falta el archivo requerido para el reporte: $RelativePath"
  }
  return Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json
}

function New-FigureHtml {
  param(
    [Parameter(Mandatory)][string]$RelativePath,
    [Parameter(Mandatory)][string]$Caption
  )
  $fullPath = Join-Path $projectRoot $RelativePath.Replace('/', '\')
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    return "<div class='pending'><strong>Evidencia pendiente:</strong> $(ConvertTo-HtmlText $Caption)<br><code>$(ConvertTo-HtmlText $RelativePath)</code></div>"
  }
  $sourceFromReport = '../' + $RelativePath.Replace('\', '/')
  return "<figure><img src='$sourceFromReport' alt='$(ConvertTo-HtmlText $Caption)'><figcaption>$(ConvertTo-HtmlText $Caption)</figcaption></figure>"
}

function New-EvidencePairHtml {
  param(
    [Parameter(Mandatory)][string]$First,
    [Parameter(Mandatory)][string]$Second,
    [Parameter(Mandatory)][string]$Caption
  )
  $firstFigure = New-FigureHtml `
    -RelativePath "09_Evidencias/$First" `
    -Caption "$Caption - entrada"
  $secondFigure = New-FigureHtml `
    -RelativePath "09_Evidencias/$Second" `
    -Caption "$Caption - resultado"
  return "<div class='figure-grid'>$firstFigure$secondFigure</div>"
}

$regression = Read-Json '07_Modelos/regression_price_model.json'
$regressionMetrics = Read-Json '07_Modelos/regression_metrics.json'
$regressionMetadata = Read-Json '05_Datasets/02_regresion_estudios_metadata.json'
$classificationReport = Read-Json '07_Modelos/classification_training_report.json'
$clustering = Read-Json '07_Modelos/clustering_estudios_model.json'
$clusteringMetadata = Read-Json '05_Datasets/clustering_estudios_metadata.json'
$volume = Read-Json '02_Base_Datos/volumen_fuentes.json'

$classEvaluation = $classificationReport.evaluation
$classSplit = $classificationReport.evaluationSplit
$classPeriod = $classificationReport.dataPeriod
if ($null -eq $classPeriod) { $classPeriod = $classificationReport.period }
if ($null -eq $classPeriod) { $classPeriod = $classSplit.eligiblePeriod }
$classSplitName = if ($classSplit.strategy) {
  [string]$classSplit.strategy
} elseif ($classSplit.temporal) {
  'holdout temporal'
} elseif ($classSplit.stratified) {
  'aleatorio estratificado'
} else {
  'documentado en el reporte JSON'
}

$classRows = foreach ($className in @(
  'completed_on_time', 'delayed', 'cancelled'
)) {
  $metric = $classEvaluation.metricsByClass.$className
  "<tr><td><code>$className</code></td><td>$(Format-Number $metric.precision)</td><td>$(Format-Number $metric.recall)</td><td>$(Format-Number $metric.f1Score)</td><td>$($metric.support)</td></tr>"
}

$clusterAlternativeRows = foreach ($candidate in $clustering.evaluation.alternatives) {
  "<tr><td>$($candidate.k)</td><td>$(Format-Number $candidate.inertia 2)</td><td>$(Format-Number $candidate.silhouette)</td><td>$(Format-Number $candidate.daviesBouldin)</td><td>$($candidate.minimumClusterSize)</td><td>$($candidate.isSelected)</td></tr>"
}

$clusterProfileRows = foreach ($profile in $clustering.profiles) {
  "<tr><td>$($profile.cluster)</td><td>$(ConvertTo-HtmlText $profile.suggestedName)</td><td>$($profile.studyCount)</td><td>$(Format-Number $profile.averages.price 2)</td><td>$(Format-Number $profile.averages.deliveryHours 2)</td><td>$(Format-Number $profile.averages.parameterCount 2)</td><td>$(Format-Number $profile.averages.requestCount 2)</td><td>$($profile.outlierCount)</td></tr>"
}

$replacements = [ordered]@{
  '{{GRUPO}}' = $(ConvertTo-HtmlText $Grupo)
  '{{EQUIPO}}' = $(ConvertTo-HtmlText $Equipo)
  '{{INTEGRANTE_1}}' = $(ConvertTo-HtmlText $Integrante1)
  '{{MATRICULA_1}}' = $(ConvertTo-HtmlText $Matricula1)
  '{{INTEGRANTE_2}}' = $(ConvertTo-HtmlText $Integrante2)
  '{{MATRICULA_2}}' = $(ConvertTo-HtmlText $Matricula2)
  '{{FECHA}}' = $(ConvertTo-HtmlText $Fecha)
  '{{SOURCE_TOTAL}}' = [string]$volume.sourceRows.total
  '{{OPERATIONAL_ROWS}}' = [string]$volume.sourceRows.operationalUsefulRows
  '{{SOURCE_STUDIES}}' = [string]$volume.sourceRows.studies
  '{{SOURCE_DETAILS}}' = [string]$volume.sourceRows.studyDetails
  '{{SOURCE_ORDERS}}' = [string]$volume.sourceRows.serviceOrders
  '{{SOURCE_ITEMS}}' = [string]$volume.sourceRows.serviceOrderItems
  '{{REG_ROWS}}' = [string]$regressionMetadata.rows
  '{{REG_SNAPSHOT}}' = $(ConvertTo-HtmlText $regressionMetadata.exportedAtUtc)
  '{{REG_TRAIN}}' = [string]$regression.split.trainingSamples
  '{{REG_TEST}}' = [string]$regression.split.testSamples
  '{{REG_MAE}}' = $(Format-Number $regressionMetrics.test.mae)
  '{{REG_RMSE}}' = $(Format-Number $regressionMetrics.test.rmse)
  '{{REG_R2}}' = $(Format-Number $regressionMetrics.test.r2)
  '{{REG_BASE_MAE}}' = $(Format-Number $regressionMetrics.baselineTest.mae)
  '{{REG_BASE_RMSE}}' = $(Format-Number $regressionMetrics.baselineTest.rmse)
  '{{REG_BASE_R2}}' = $(Format-Number $regressionMetrics.baselineTest.r2)
  '{{REG_REAL_MAE}}' = $(Format-Number $regressionMetrics.testByOrigin.real.mae)
  '{{REG_REAL_RMSE}}' = $(Format-Number $regressionMetrics.testByOrigin.real.rmse)
  '{{REG_REAL_R2}}' = $(Format-Number $regressionMetrics.testByOrigin.real.r2)
  '{{CLASS_ROWS}}' = [string]$classificationReport.quality.rowsAccepted
  '{{CLASS_EXTRACTED}}' = [string]$classificationReport.quality.rowsExtracted
  '{{CLASS_REJECTED}}' = [string]$classificationReport.quality.rowsRejected
  '{{CLASS_TRAIN}}' = [string]$classSplit.trainingRows
  '{{CLASS_TEST}}' = [string]$classSplit.testRows
  '{{CLASS_SPLIT}}' = $(ConvertTo-HtmlText $classSplitName)
  '{{CLASS_PERIOD_START}}' = $(ConvertTo-HtmlText $classPeriod.start)
  '{{CLASS_PERIOD_END}}' = $(ConvertTo-HtmlText $classPeriod.end)
  '{{CLASS_ACCURACY}}' = $(Format-Number $classEvaluation.accuracy)
  '{{CLASS_BASE_ACCURACY}}' = $(Format-Number $classEvaluation.baseline.accuracy)
  '{{CLASS_MACRO_F1}}' = $(Format-Number $classEvaluation.macroAverage.f1Score)
  '{{CLASS_BASE_MACRO_F1}}' = $(Format-Number $classEvaluation.baseline.macroAverage.f1Score)
  '{{CLASS_COMPLETED}}' = [string]$classificationReport.classDistribution.completed_on_time
  '{{CLASS_DELAYED}}' = [string]$classificationReport.classDistribution.delayed
  '{{CLASS_CANCELLED}}' = [string]$classificationReport.classDistribution.cancelled
  '{{CLASS_METRIC_ROWS}}' = ($classRows -join [Environment]::NewLine)
  '{{CLUSTER_ROWS}}' = [string]$clusteringMetadata.composition.totalRows
  '{{CLUSTER_PERIOD_START}}' = $(ConvertTo-HtmlText $clusteringMetadata.periodStart)
  '{{CLUSTER_PERIOD_END}}' = $(ConvertTo-HtmlText $clusteringMetadata.periodEnd)
  '{{CLUSTER_K}}' = [string]$clustering.evaluation.selectedK
  '{{CLUSTER_SILHOUETTE}}' = $(Format-Number $clustering.evaluation.silhouetteScore)
  '{{CLUSTER_DB}}' = $(Format-Number $clustering.evaluation.daviesBouldinScore)
  '{{CLUSTER_OUTLIERS}}' = [string](
    ($clustering.profiles | Measure-Object -Property outlierCount -Sum).Sum
  )
  '{{CLUSTER_ALTERNATIVE_ROWS}}' = ($clusterAlternativeRows -join [Environment]::NewLine)
  '{{CLUSTER_PROFILE_ROWS}}' = ($clusterProfileRows -join [Environment]::NewLine)
  '{{FIG_CLUSTER_NUMERIC}}' = $(New-FigureHtml '09_Evidencias/clustering_eda_numericas.png' 'Distribuciones numericas del dataset de clustering.')
  '{{FIG_CLUSTER_K}}' = $(New-FigureHtml '09_Evidencias/clustering_comparacion_k.png' 'Comparacion exploratoria de K-Means para k=2 a 6; el JSON final conserva las metricas exactas del backend.')
  '{{FIG_REG_EDA}}' = $(New-FigureHtml '09_Evidencias/regression_eda_variables.png' 'Distribucion y calidad de las variables X de regresion.')
  '{{FIG_REG_ACTUAL}}' = $(New-FigureHtml '06_Notebooks/regression_reales_vs_predichos.png' 'Precio real frente al estimado en el conjunto de prueba.')
  '{{FIG_REG_RESIDUALS}}' = $(New-FigureHtml '06_Notebooks/regression_residuos.png' 'Residuos de la regresion en prueba.')
  '{{FIG_CLASS_EDA}}' = $(New-FigureHtml '09_Evidencias/clasificacion_eda_variables_x.png' 'EDA de las variables disponibles al registrar una orden.')
  '{{FIG_CLASS_PERIODS}}' = $(New-FigureHtml '09_Evidencias/clasificacion_balance_periodos.png' 'Balance de clases y periodos cronologicos de train/test.')
  '{{FIG_CLASS_MATRIX}}' = $(New-FigureHtml '09_Evidencias/clasificacion_matriz_confusion.png' 'Matriz de confusion del holdout de clasificacion.')
  '{{WEB_CASE_1}}' = $(New-EvidencePairHtml '01_clustering_resumen.png' '02_clustering_comparacion.png' 'Caso 1: comparacion de clusters')
  '{{WEB_CASE_2}}' = $(New-EvidencePairHtml '03_clustering_atipico_lista.png' '04_clustering_atipico_detalle.png' 'Caso 2: estudio atipico')
  '{{WEB_CASE_3}}' = $(New-EvidencePairHtml '05_regresion_estimacion.png' '06_regresion_precio_aplicado.png' 'Caso 3: precio sugerido y aplicado')
  '{{WEB_CASE_4}}' = $(New-EvidencePairHtml '07_regresion_segunda_entrada.png' '08_regresion_segundo_resultado.png' 'Caso 4: segunda entrada de regresion')
  '{{WEB_CASE_5}}' = $(New-EvidencePairHtml '09_clasificacion_entrada.png' '10_clasificacion_pronostico.png' 'Caso 5: pronostico durante el registro')
  '{{WEB_CASE_6}}' = $(New-EvidencePairHtml '11_clasificacion_segunda_entrada.png' '12_clasificacion_segundo_resultado.png' 'Caso 6: cambio de contexto de clasificacion')
}

$html = Get-Content -LiteralPath $templatePath -Raw -Encoding utf8
foreach ($entry in $replacements.GetEnumerator()) {
  $html = $html.Replace([string]$entry.Key, [string]$entry.Value)
}
if ($html -match '\{\{[A-Z0-9_]+\}\}') {
  throw "La plantilla conserva un marcador sin resolver: $($Matches[0])"
}
[IO.File]::WriteAllText(
  $temporaryHtmlPath,
  $html,
  (New-Object Text.UTF8Encoding($false))
)

& python $converterPath $temporaryHtmlPath $docxPath
if ($LASTEXITCODE -ne 0) {
  throw 'No se pudo generar el DOCX. Instala 01_Reporte/requirements.txt.'
}

try {
  $browserCandidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  )
  $browserPath = $browserCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
  if (-not $browserPath) {
    throw 'No se encontro Google Chrome ni Microsoft Edge para generar el PDF.'
  }

  if (Test-Path -LiteralPath $pdfPath) {
    Remove-Item -LiteralPath $pdfPath -Force
  }
  New-Item -ItemType Directory -Path $temporaryBrowserProfile | Out-Null
  $htmlUri = ([Uri]$temporaryHtmlPath).AbsoluteUri
  $browserOutput = & $browserPath `
    '--headless=new' `
    '--disable-gpu' `
    '--no-pdf-header-footer' `
    "--user-data-dir=$temporaryBrowserProfile" `
    "--print-to-pdf=$pdfPath" `
    $htmlUri 2>&1
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "El navegador no pudo generar el PDF: $($browserOutput -join ' ')"
  }

  # Edge puede delegar la impresion a un proceso hijo. Se conserva el HTML
  # hasta que el PDF este completo y su tamano permanezca estable.
  $pdfDeadline = [DateTime]::UtcNow.AddSeconds(45)
  $previousPdfLength = -1
  $stablePdfChecks = 0
  do {
    $pdfReady = $false
    if (Test-Path -LiteralPath $pdfPath -PathType Leaf) {
      try {
        $currentPdfBytes = [IO.File]::ReadAllBytes($pdfPath)
        $currentPdfLength = $currentPdfBytes.Length
        $tailLength = [Math]::Min(2048, $currentPdfLength)
        $tailStart = $currentPdfLength - $tailLength
        $pdfTail = [Text.Encoding]::ASCII.GetString(
          $currentPdfBytes,
          $tailStart,
          $tailLength
        )
        $hasPdfEndMarker = $pdfTail.Contains('%%EOF')
        if (
          $currentPdfLength -ge 100000 -and
          $currentPdfLength -eq $previousPdfLength -and
          $hasPdfEndMarker
        ) {
          $stablePdfChecks++
        } else {
          $stablePdfChecks = 0
        }
        $previousPdfLength = $currentPdfLength
        $pdfReady = $stablePdfChecks -ge 3
      } catch {
        $stablePdfChecks = 0
      }
    }
    if (-not $pdfReady) { Start-Sleep -Milliseconds 250 }
  } while (-not $pdfReady -and [DateTime]::UtcNow -lt $pdfDeadline)

  if (
    -not (Test-Path -LiteralPath $pdfPath -PathType Leaf) -or
    (Get-Item -LiteralPath $pdfPath).Length -lt 100000
  ) {
    throw 'El navegador finalizo sin crear el reporte PDF completo.'
  }
  $pdfBytes = [IO.File]::ReadAllBytes($pdfPath)
  $pdfSignature = [Text.Encoding]::ASCII.GetString($pdfBytes, 0, 5)
  if ($pdfSignature -ne '%PDF-') {
    throw 'El archivo generado no tiene una firma PDF valida.'
  }
  $pdfTailLength = [Math]::Min(2048, $pdfBytes.Length)
  $pdfTail = [Text.Encoding]::ASCII.GetString(
    $pdfBytes,
    $pdfBytes.Length - $pdfTailLength,
    $pdfTailLength
  )
  if (-not $pdfTail.Contains('%%EOF')) {
    throw 'El archivo PDF no contiene su marcador de cierre.'
  }

  Write-Output "Reporte Word: $docxPath"
  Write-Output "Reporte PDF:  $pdfPath"
} finally {
  if (
    (Test-Path -LiteralPath $temporaryHtmlPath) -and
    $temporaryHtmlPath.StartsWith($reportRoot, [StringComparison]::OrdinalIgnoreCase)
  ) {
    Remove-Item -LiteralPath $temporaryHtmlPath -Force
  }
  if (
    (Test-Path -LiteralPath $temporaryBrowserProfile -PathType Container) -and
    $temporaryBrowserProfile.StartsWith($reportRoot, [StringComparison]::OrdinalIgnoreCase)
  ) {
    try {
      $ownedBrowserProcesses = Get-CimInstance Win32_Process |
        Where-Object {
          $_.CommandLine -and
          $_.CommandLine.IndexOf(
            $temporaryBrowserProfile,
            [StringComparison]::OrdinalIgnoreCase
          ) -ge 0
        }
      foreach ($ownedProcess in $ownedBrowserProcesses) {
        Stop-Process -Id $ownedProcess.ProcessId -Force -ErrorAction SilentlyContinue
      }
      Start-Sleep -Milliseconds 250
      Remove-Item -LiteralPath $temporaryBrowserProfile -Recurse -Force
    } catch {
      Write-Warning "No se pudo retirar el perfil temporal: $temporaryBrowserProfile"
    }
  }
}
