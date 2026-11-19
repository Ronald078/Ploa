param([switch]$Desativar)
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tailscalePath = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$configPath = Join-Path $projectPath 'crm\acesso-celular.json'
if (-not (Test-Path -LiteralPath $tailscalePath)) { throw 'Instale o Tailscale oficial em https://tailscale.com/download/windows e execute novamente.' }
if ($Desativar) {
  @{ enabled = $false } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
  & $tailscalePath serve --https=443 off
  if ($LASTEXITCODE -ne 0) { throw 'O acesso do Ploa foi bloqueado; confira o Tailscale para desligar o compartilhamento HTTPS.' }
  Write-Host 'Acesso pelo celular desativado. A conexão local do Ploa foi preservada.'
  exit
}
$rawStatus = & $tailscalePath status --json
if ($LASTEXITCODE -ne 0) { throw 'Abra o Tailscale e entre na sua conta. Se houver acesso negado, execute este arquivo como administrador.' }
$state = $rawStatus | ConvertFrom-Json
if ($state.BackendState -ne 'Running') {
  Write-Host 'Entre na sua conta pelo link que o Tailscale apresentar. Depois execute este arquivo novamente.'
  & $tailscalePath up --timeout=30s
  exit
}
$hostName = $state.Self.DNSName.TrimEnd('.').ToLowerInvariant()
$userKey = [string]$state.Self.UserID
$profile = $state.User.PSObject.Properties[$userKey].Value
$loginName = [string]$profile.LoginName
if ($hostName -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$' -or -not $loginName -or $loginName -match '[\s\x00-\x1f\x7f]') { throw 'Não foi possível confirmar o endereço privado e a conta proprietária. Não foi liberado nenhum acesso.' }
# Do not replace an unrelated existing Serve configuration.
$rawServe = & $tailscalePath serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível verificar os serviços privados existentes.' }
$serveState = $rawServe | ConvertFrom-Json
if ($serveState.Web) {
  foreach ($web in $serveState.Web.PSObject.Properties) {
    foreach ($handler in $web.Value.Handlers.PSObject.Properties) {
      if ($handler.Value.Proxy -ne 'http://127.0.0.1:4311' -and $handler.Value.Proxy -ne 'http://127.0.0.1:4311/') { throw 'Já existe outro serviço publicado no Tailscale. A configuração existente foi preservada.' }
    }
  }
}
# An exact owner identity is required; shared devices and other tailnet users are denied.
@{ enabled = $true; hostname = $hostName; login = $loginName } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
$probe = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 4311 -State Listen -ErrorAction SilentlyContinue
if (-not $probe) {
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  Start-Process -FilePath $nodePath -ArgumentList @('"' + (Join-Path $projectPath 'crm\scripts\acesso-celular.js') + '"') -WorkingDirectory $projectPath -WindowStyle Hidden
  Start-Sleep -Milliseconds 600
}
& $tailscalePath serve --bg --yes --https=443 http://127.0.0.1:4311
if ($LASTEXITCODE -ne 0) { throw 'O Tailscale precisa concluir a autorização HTTPS. Abra o link indicado e execute este arquivo novamente.' }
$privateUrl = 'https://' + $hostName
Write-Host "Ploa no celular: $privateUrl"
Write-Host 'Instale o Tailscale no celular, entre na MESMA conta, conecte e abra esse endereço no navegador.'
Write-Host 'Mantenha o notebook ligado, conectado e com o Ploa aberto. Não é um endereço público.'
Set-Content -LiteralPath (Join-Path $projectPath 'Ploa no celular.txt') -Value "$privateUrl`r`n`r`nTailscale conectado na mesma conta. Notebook ligado, conectado e com Ploa aberto." -Encoding utf8
