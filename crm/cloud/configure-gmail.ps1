param([switch]$CheckLayout)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PloaGmailWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
'@
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$codexRoot = Split-Path (Split-Path $projectRoot -Parent) -Parent
$nodePath = Join-Path $codexRoot 'Ferramentas\node-v24.18.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
  $foundNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($foundNode) { $nodePath = $foundNode.Source }
  else { throw 'O Node do Ploa não foi localizado.' }
}
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Ploa - Conectar Gmail'
$form.ClientSize = New-Object System.Drawing.Size(520, 354)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(7, 19, 31)
$form.ForeColor = [System.Drawing.Color]::FromArgb(225, 237, 250)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.AutoScaleMode = 'Dpi'
$form.Add_Shown({ [void][PloaGmailWindow]::ShowWindow($form.Handle, 5); $form.Activate() })
function New-Label($text, $x, $y, $width, $height) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text; $label.Location = New-Object System.Drawing.Point($x,$y)
  $label.Size = New-Object System.Drawing.Size($width,$height)
  $form.Controls.Add($label); return $label
}
$heading = New-Label 'Conecte o e-mail do Ploa' 24 22 472 29
$heading.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$description = New-Label 'Use a senha de app gerada pelo Google. A senha fica protegida neste usuario do Windows.' 24 60 472 42
$emailLabel = New-Label 'Gmail remetente' 24 112 472 22
$email = New-Object System.Windows.Forms.TextBox
$email.Text = 'contato.ploa@gmail.com'; $email.ReadOnly = $true
$email.Location = New-Object System.Drawing.Point(24,138); $email.Size = New-Object System.Drawing.Size(472,28)
$form.Controls.Add($email)
$passwordLabel = New-Label 'Senha de app do Google' 24 180 472 22
$password = New-Object System.Windows.Forms.TextBox
$password.UseSystemPasswordChar = $true; $password.MaxLength = 32
$password.Location = New-Object System.Drawing.Point(24,206); $password.Size = New-Object System.Drawing.Size(472,28)
$form.Controls.Add($password)
$save = New-Object System.Windows.Forms.Button
$save.Text = 'Salvar e verificar'; $save.Location = New-Object System.Drawing.Point(24,252)
$save.Size = New-Object System.Drawing.Size(194,38); $save.FlatStyle = 'Flat'
$save.BackColor = [System.Drawing.Color]::FromArgb(176,208,255); $save.ForeColor = [System.Drawing.Color]::FromArgb(15,32,49)
$form.Controls.Add($save)
$close = New-Object System.Windows.Forms.Button
$close.Text = 'Fechar'; $close.Location = New-Object System.Drawing.Point(230,252)
$close.Size = New-Object System.Drawing.Size(104,38); $close.FlatStyle = 'Flat'; $form.Controls.Add($close)
$status = New-Label 'A verificacao de conexao nao envia e-mail.' 24 304 472 40
$script:child = $null
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$save.Add_Click({
  $normalized = $password.Text -replace '\s',''
  if ($normalized -notmatch '^[a-zA-Z0-9]{16}$') { $status.Text = 'Cole a senha de app de 16 caracteres gerada pelo Google.'; return }
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $nodePath
  $start.Arguments = '"' + (Join-Path $PSScriptRoot 'configure-gmail.js') + '"'
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $start.WorkingDirectory = $projectRoot
  $script:child = New-Object System.Diagnostics.Process
  $script:child.StartInfo = $start
  try {
    [void]$script:child.Start()
    $payload = @{user=$email.Text;appPassword=$normalized} | ConvertTo-Json -Compress
    $script:child.StandardInput.Write($payload); $script:child.StandardInput.Close()
    $payload = $null; $normalized = $null; $password.Clear()
    $save.Enabled = $false; $password.Enabled = $false
    $status.Text = 'Verificando a conexao com o Google. Nenhum e-mail sera enviado.'
    $timer.Start()
  } catch { $status.Text = 'Nao foi possivel iniciar a configuracao.' }
})
$timer.Add_Tick({
  if ($script:child -and $script:child.HasExited) {
    $timer.Stop()
    try { $result = $script:child.StandardOutput.ReadToEnd() | ConvertFrom-Json; $status.Text = $result.message }
    catch { $status.Text = 'Nao foi possivel confirmar a conexao. Tente novamente.' }
    $script:child.Dispose(); $script:child = $null
    $save.Enabled = $true; $password.Enabled = $true
  }
})
$close.Add_Click({ $form.Close() })
$form.Add_FormClosing({
  $timer.Stop()
  if ($script:child) { if (-not $script:child.HasExited) { $script:child.Kill() }; $script:child.Dispose() }
  $password.Clear()
})
if ($CheckLayout) {
  $outside = @($form.Controls | Where-Object { $_.Right -gt $form.ClientSize.Width -or $_.Bottom -gt $form.ClientSize.Height -or $_.Left -lt 0 -or $_.Top -lt 0 })
  @{controls=$form.Controls.Count;outside=$outside.Count;passwordMasked=$password.UseSystemPasswordChar;sender=$email.Text} | ConvertTo-Json -Compress
  $form.Dispose(); $timer.Dispose(); exit
}
[void]$form.ShowDialog()
$form.Dispose(); $timer.Dispose()
