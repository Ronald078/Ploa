param([switch]$CheckLayout)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PloaPrivateGmailWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
'@

# Existing credential only. Never writes a password, log or provider setting.
$script:secret = $null
$script:copied = $false
if ($CheckLayout) { $script:secret = 'fixtureonly12345' }
else {
  try {
    $file = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Ploa\Cloud\Gmail\credenciais-ia.dpapi.json'
    $saved = [IO.File]::ReadAllText($file) | ConvertFrom-Json
    if ($saved.version -ne 1) { throw 'invalid' }
    $bytes = [Convert]::FromBase64String($saved.ciphertext)
    $entropy = [Text.Encoding]::UTF8.GetBytes('Ploa.AI.Credentials.v1')
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $credentials = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
    $script:secret = [string]$credentials.gmail.appPassword -replace '\s',''
    if ($credentials.gmail.user -ne 'contato.ploa@gmail.com' -or $script:secret -notmatch '^[a-zA-Z0-9]{16}$') { throw 'invalid' }
    [Array]::Clear($plain, 0, $plain.Length)
    $plain = $null; $credentials = $null; $saved = $null
  } catch {
    [void][Windows.Forms.MessageBox]::Show('Nao foi possivel recuperar a senha salva neste usuario do Windows. Use o configurador de Gmail do Ploa.', 'Ploa - Senha de app')
    exit 1
  }
}

$form = New-Object Windows.Forms.Form
$form.Text = 'Ploa - Copiar senha de app do Gmail'
$form.ClientSize = New-Object Drawing.Size(540, 286)
$form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false; $form.MinimizeBox = $false
$form.BackColor = [Drawing.Color]::FromArgb(7,19,31)
$form.ForeColor = [Drawing.Color]::FromArgb(225,237,250)
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
$form.Add_Shown({ [void][PloaPrivateGmailWindow]::ShowWindow($form.Handle, 5); $form.Activate() })

$label = New-Object Windows.Forms.Label
$label.Text = 'Senha de app salva - contato.ploa@gmail.com'
$label.Location = New-Object Drawing.Point(24,24); $label.Size = New-Object Drawing.Size(492,28)
$form.Controls.Add($label)
$description = New-Object Windows.Forms.Label
$description.Text = 'Clique em Copiar senha e cole no campo de senha SMTP do Supabase. A senha permanece oculta nesta janela.'
$description.Location = New-Object Drawing.Point(24,63); $description.Size = New-Object Drawing.Size(492,48)
$form.Controls.Add($description)
$password = New-Object Windows.Forms.TextBox
$password.ReadOnly = $true; $password.UseSystemPasswordChar = $true
$password.Text = $script:secret
$password.Location = New-Object Drawing.Point(24,123); $password.Size = New-Object Drawing.Size(492,28)
$form.Controls.Add($password)
$copy = New-Object Windows.Forms.Button
$copy.Text = 'Copiar senha'; $copy.Location = New-Object Drawing.Point(24,172)
$copy.Size = New-Object Drawing.Size(184,40); $copy.FlatStyle = 'Flat'
$copy.BackColor = [Drawing.Color]::FromArgb(176,208,255); $copy.ForeColor = [Drawing.Color]::FromArgb(15,32,49)
$form.Controls.Add($copy)
$close = New-Object Windows.Forms.Button
$close.Text = 'Fechar'; $close.Location = New-Object Drawing.Point(220,172)
$close.Size = New-Object Drawing.Size(104,40); $close.FlatStyle = 'Flat'
$form.Controls.Add($close)
$status = New-Object Windows.Forms.Label
$status.Text = 'A senha copiada sera limpa em 60 segundos ou ao fechar, se ainda estiver na area de transferencia.'
$status.Location = New-Object Drawing.Point(24,230); $status.Size = New-Object Drawing.Size(492,42)
$form.Controls.Add($status)
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 60000
function Clear-PloaCopiedPassword {
  if ($script:copied) {
    try {
      if ([Windows.Forms.Clipboard]::ContainsText() -and [Windows.Forms.Clipboard]::GetText() -ceq $script:secret) { [Windows.Forms.Clipboard]::Clear() }
      $script:copied = $false
    } catch { $status.Text = 'A area de transferencia esta ocupada. Copie outro texto depois de usar a senha.' }
  }
}
$copy.Add_Click({
  try {
    [Windows.Forms.Clipboard]::SetText($script:secret)
    $script:copied = $true
    $status.Text = 'Senha copiada. Cole no Supabase agora. Limpeza em 60 segundos.'
    $timer.Stop(); $timer.Start()
  } catch { $status.Text = 'Nao foi possivel copiar. Tente novamente.' }
})
$timer.Add_Tick({
  $timer.Stop(); Clear-PloaCopiedPassword
  if (-not $script:copied) { $status.Text = 'Senha removida da area de transferencia, caso ainda estivesse copiada.' }
})
$close.Add_Click({ $form.Close() })
$form.Add_FormClosing({ $timer.Stop(); Clear-PloaCopiedPassword; $password.Clear(); $script:secret = $null })
if ($CheckLayout) {
  $outside = @($form.Controls | Where-Object { $_.Right -gt $form.ClientSize.Width -or $_.Bottom -gt $form.ClientSize.Height -or $_.Left -lt 0 -or $_.Top -lt 0 })
  @{controls=$form.Controls.Count;outside=$outside.Count;passwordMasked=$password.UseSystemPasswordChar;readOnly=$password.ReadOnly} | ConvertTo-Json -Compress
  $password.Clear(); $script:secret=$null; $form.Dispose(); $timer.Dispose(); exit
}
[void]$form.ShowDialog()
$script:secret = $null
$form.Dispose(); $timer.Dispose()
