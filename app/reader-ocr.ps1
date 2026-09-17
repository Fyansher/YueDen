$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ocrRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$ocrAwaitMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-OcrOperation($Operation, [Type]$ResultType) {
 $ocrTask = $ocrAwaitMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
 $ocrTask.Wait()
 return $ocrTask.Result
}
$ocrFile = Wait-OcrOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync([string]$ocrRequest.file)) ([Windows.Storage.StorageFile])
$ocrStream = Wait-OcrOperation ($ocrFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
 $ocrDecoder = Wait-OcrOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ocrStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $ocrBitmap = Wait-OcrOperation ($ocrDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 try {
  $ocrLanguages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -match '^(zh|en|ja)(-|$)' } | Select-Object -First 5)
  if ($ocrLanguages.Count -eq 0) { throw 'Windows 未安装中文、英文或日文 OCR 组件，请先安装所需系统 OCR 语言组件。' }
  $ocrVariants = @()
  foreach ($ocrLanguage in $ocrLanguages) {
   $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($ocrLanguage)
   if ($null -eq $ocrEngine) { continue }
   $ocrResult = Wait-OcrOperation ($ocrEngine.RecognizeAsync($ocrBitmap)) ([Windows.Media.Ocr.OcrResult])
   $ocrLines = @($ocrResult.Lines | ForEach-Object { $words=@($_.Words); if($words.Count) { @{text=$_.Text;y=[double]$words[0].BoundingRect.Y;height=[double]$words[0].BoundingRect.Height} } })
   $ocrVariants += @{language=$ocrLanguage.LanguageTag; text=$ocrResult.Text; lines=$ocrLines}
  }
  @{ variants=$ocrVariants; language=($ocrVariants.language -join ', '); missing=@('zh-Hans','zh-Hant','en','ja' | Where-Object { $desired=$_; -not ($ocrLanguages.LanguageTag | Where-Object { $_ -like "$desired*" -or ($desired -eq 'zh-Hans' -and $_ -eq 'zh-CN') -or ($desired -eq 'zh-Hant' -and $_ -eq 'zh-TW') }) }) } | ConvertTo-Json -Depth 6 -Compress
 } finally { if ($null -ne $ocrBitmap) { $ocrBitmap.Dispose() } }
} finally { $ocrStream.Dispose() }
