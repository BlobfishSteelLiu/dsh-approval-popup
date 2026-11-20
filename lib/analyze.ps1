# Semantic high-risk analysis for one PowerShell command.
# Reads {"command":"..."} from DSH_ANALYZE_INPUT and writes
# {"highRisk":bool,"reasons":[...]} to DSH_ANALYZE_OUTPUT.
$ErrorActionPreference = 'Stop'
function Write-Result([string]$json) {
    [System.IO.File]::WriteAllText($env:DSH_ANALYZE_OUTPUT, $json, (New-Object System.Text.UTF8Encoding($false)))
}
try {
    $payload = Get-Content -Raw -LiteralPath $env:DSH_ANALYZE_INPUT -Encoding UTF8 | ConvertFrom-Json
    $command = [string]$payload.command
    if ([string]::IsNullOrWhiteSpace($command)) {
        Write-Result '{"highRisk":false,"reasons":[]}'
        exit 0
    }

    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($command, [ref]$tokens, [ref]$errors)
    $commands = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)

    $aliases = @{
        'ri' = 'remove-item'; 'rm' = 'remove-item'; 'del' = 'remove-item';
        'erase' = 'remove-item'; 'rmdir' = 'remove-item'; 'rd' = 'remove-item';
        'ni' = 'new-item'; 'si' = 'set-item'; 'sc' = 'set-content';
        'ac' = 'add-content'; 'cp' = 'copy-item'; 'mv' = 'move-item';
        'ren' = 'rename-item'; 'iex' = 'invoke-expression'
    }
    $destructive = @(
        'remove-item', 'clear-content', 'remove-itemproperty', 'remove-psdrive',
        'format-volume', 'clear-disk', 'initialize-disk', 'remove-partition', 'remove-disk'
    )
    $modifying = @(
        'new-item', 'set-item', 'new-itemproperty', 'set-itemproperty',
        'set-content', 'add-content', 'out-file', 'rename-item', 'move-item', 'copy-item'
    )
    $reasons = New-Object System.Collections.Generic.List[string]
    $categories = New-Object System.Collections.Generic.HashSet[string]
    $risk = $false

    foreach ($cmd in $commands) {
        $name = $cmd.GetCommandName()
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $key = $name.ToLowerInvariant()
        if ($aliases.ContainsKey($key)) { $key = $aliases[$key] }

        $argText = (@($cmd.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text }) -join ' ')
        $registry = $argText -match '(?i)(HKLM|HKCU|HKCR|HKU|HKCC):|Registry::'
        $systemPath = $argText -match '(?i)([A-Z]:\\(Windows|Program Files|ProgramData)|%windir%|\$env:(windir|SystemRoot)|System32|\\Windows\\)'

        if ($key -eq 'invoke-expression') {
            $risk = $true
            $reasons.Add('dynamic expression')
            [void]$categories.Add('dynamic')
            continue
        }
        if ($destructive -contains $key) {
            $risk = $true
            $reasons.Add($key)
            if ($key -in @('format-volume', 'clear-disk', 'initialize-disk', 'remove-partition', 'remove-disk')) {
                [void]$categories.Add('disk')
            } else {
                [void]$categories.Add('delete')
            }
            continue
        }
        if ($key -in @('reg', 'reg.exe', 'regedit', 'regedit.exe')) {
            if ($argText -match '(?i)\b(add|delete|import|load|restore|copy)\b') {
                $risk = $true
                $reasons.Add($key)
                [void]$categories.Add('registry')
            }
            continue
        }
        if ($key -in @('sc', 'sc.exe') -and $argText -match '(?i)\b(delete|config|create|stop|start)\b') {
            $risk = $true
            $reasons.Add($key)
            [void]$categories.Add('disk')
            continue
        }
        if ($key -in @('bcdedit', 'bcdedit.exe', 'diskpart', 'diskpart.exe', 'format', 'format.com', 'shutdown', 'shutdown.exe')) {
            $risk = $true
            $reasons.Add($key)
            [void]$categories.Add('disk')
            continue
        }
        if ($key -in @('cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe')) {
            if ($argText -match '(?i)\b(del|erase|rmdir|rd|remove-item)\b') {
                $risk = $true
                $reasons.Add("nested $key")
                [void]$categories.Add('delete')
            }
            if ($argText -match '(?i)\breg(?:edit)?\b') {
                $risk = $true
                [void]$categories.Add('registry')
            }
            if ($argText -match '(?i)\b(format|diskpart|bcdedit)\b') {
                $risk = $true
                [void]$categories.Add('disk')
            }
            if ($argText -match '(?i)\b(takeown|icacls)\b') {
                $risk = $true
                [void]$categories.Add('permissions')
            }
            continue
        }
        if ($modifying -contains $key -and ($registry -or $systemPath)) {
            $risk = $true
            $reasons.Add("$key -> protected target")
            if ($registry) {
                [void]$categories.Add('registry')
            } else {
                [void]$categories.Add('systemFiles')
            }
            continue
        }
        if ($key -in @('takeown', 'icacls', 'set-acl', 'set-executionpolicy', 'stop-service', 'set-service', 'remove-service', 'new-service')) {
            $risk = $true
            $reasons.Add($key)
            [void]$categories.Add('permissions')
        }
    }

    # .NET method calls such as [System.IO.File]::Delete(...) do not appear as
    # CommandAst nodes; inspect invoked member names as well.
    $members = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)
    foreach ($member in $members) {
        $memberName = [string]$member.Member.Value
        if ($memberName -match '(?i)^(Delete|DeleteSubKey|DeleteSubKeyTree|DeleteValue|Remove|SetValue|WriteAllText|WriteAllBytes|Move)$') {
            $risk = $true
            $reasons.Add("method $memberName")
            if ($memberName -match '(?i)^(DeleteSubKey|DeleteSubKeyTree|DeleteValue|SetValue)$') {
                [void]$categories.Add('registry')
            } else {
                [void]$categories.Add('delete')
            }
        }
    }

    if ($risk -and $categories.Count -eq 0) {
        [void]$categories.Add('systemFiles')
    }

    if ($risk) {
        Write-Result (@{ highRisk = $true; reasons = @($reasons); categories = @($categories) } | ConvertTo-Json -Compress)
    } else {
        Write-Result '{"highRisk":false,"reasons":[],"categories":[]}'
    }
}
catch {
    Write-Result '{"highRisk":false,"reasons":[],"error":"analyzer failed"}'
}
