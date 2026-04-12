$baseDir = $PSScriptRoot

# ===== Single-instance lock (file lock - OS releases handle on process exit) =====
$lockFile = Join-Path $baseDir "alarm_monitor.lock"
$lockStream = $null
try {
    $lockStream = [System.IO.File]::Open(
        $lockFile,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch {
    exit
}

# ===== Config =====
$configPath = Join-Path $baseDir "config.json"
$configContent = '{"userName":"Guest", "dataDirectoryPath":"./data"}'
if (Test-Path $configPath) {
    $configContent = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
}
$configObj = $configContent | ConvertFrom-Json
$dataDir = $configObj.dataDirectoryPath
if (-not $dataDir) { $dataDir = "./data" }

$dataDirFull = Join-Path $baseDir $dataDir
$alarmsFile  = Join-Path $dataDirFull "alarms.json"
$logFile     = Join-Path $baseDir "alarm_monitor.log"

# ===== Logging =====
function Write-Log {
    param([string]$message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    [System.IO.File]::AppendAllText(
        $logFile,
        "[$timestamp] $message`r`n",
        (New-Object System.Text.UTF8Encoding($false))
    )
}

Write-Log "Alarm Monitor started. Monitoring $alarmsFile"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Build Japanese strings from Unicode code points (encoding-independent)
# 0x3010=[ 0x30A2=A 0x30E9=ra 0x30FC=- 0x30E0=mu 0x3011=] => [alarm]
# 0x78BA=confirm 0x8A8D=ok 0x3057=shi 0x307E=ma 0x3057=shi 0x305F=ta
$alarmHeader = [System.String]::new([char[]]@(0x3010, 0x30A2, 0x30E9, 0x30FC, 0x30E0, 0x3011))
$confirmText  = [System.String]::new([char[]]@(0x78BA, 0x8A8D, 0x3057, 0x307E, 0x3057, 0x305F))

# ===== Alarm popup =====
function Show-BigAlarm {
    param([string]$title)

    $form = New-Object System.Windows.Forms.Form
    $form.Text            = "Taskflow Alarm"
    $form.BackColor       = [System.Drawing.ColorTranslator]::FromHtml("#1C212D")
    $form.Width           = 800
    $form.Height          = 600
    $form.StartPosition   = "CenterScreen"
    $form.TopMost         = $true
    $form.FormBorderStyle = "FixedDialog"

    $label           = New-Object System.Windows.Forms.Label
    $label.Text      = $alarmHeader + "`n" + $title
    $label.Font      = New-Object System.Drawing.Font("Meiryo", 32, [System.Drawing.FontStyle]::Bold)
    $label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#E2E8F0")
    $label.AutoSize  = $false
    $label.Dock      = "Fill"
    $label.TextAlign = "MiddleCenter"
    $form.Controls.Add($label)

    $btn           = New-Object System.Windows.Forms.Button
    $btn.Text      = $confirmText
    $btn.Font      = New-Object System.Drawing.Font("Meiryo", 16)
    $btn.Height    = 80
    $btn.Dock      = "Bottom"
    $btn.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#6366F1")
    $btn.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#FFFFFF")
    $btn.FlatStyle = "Flat"
    $btn.Add_Click({ $form.Close() })
    $form.Controls.Add($btn)

    $form.ShowDialog() | Out-Null
}

# ===== Main monitor loop =====
while ($true) {
    if (Test-Path $alarmsFile) {
        $content = [System.IO.File]::ReadAllText($alarmsFile, [System.Text.Encoding]::UTF8)
        try {
            $alarms = $content | ConvertFrom-Json
            if ($null -eq $alarms)      { $alarms = @() }
            if ($alarms -isnot [Array]) { $alarms = @($alarms) }

            $now = Get-Date

            foreach ($alarm in $alarms) {
                if ($alarm.status -ne 'pending') { continue }

                $triggerTime = [DateTime]($alarm.triggerTime)
                if ($now -lt $triggerTime) { continue }

                Write-Log "Triggering alarm: $($alarm.title)"
                Show-BigAlarm -title $alarm.title
                Write-Log "Alarm popup closed."

                # Re-read file after popup (web UI may have changed it while popup was open)
                # Update only the triggered alarm by ID, then write back
                try {
                    $latestContent = [System.IO.File]::ReadAllText($alarmsFile, [System.Text.Encoding]::UTF8)
                    $latestAlarms  = $latestContent | ConvertFrom-Json
                    if ($null -eq $latestAlarms)      { $latestAlarms = @() }
                    if ($latestAlarms -isnot [Array]) { $latestAlarms = @($latestAlarms) }

                    $target = $latestAlarms | Where-Object { $_.id -eq $alarm.id }
                    if ($target) {
                        if ($alarm.recurrence -eq 'daily') {
                            $target.triggerTime = $triggerTime.AddDays(1).ToString("yyyy-MM-ddTHH:mm")
                        } elseif ($alarm.recurrence -eq 'weekly') {
                            $target.triggerTime = $triggerTime.AddDays(7).ToString("yyyy-MM-ddTHH:mm")
                        } elseif ($alarm.recurrence -eq 'monthly') {
                            $target.triggerTime = $triggerTime.AddMonths(1).ToString("yyyy-MM-ddTHH:mm")
                        } else {
                            $target.status = 'completed'
                        }

                        $json = $latestAlarms | ConvertTo-Json -Depth 10 -Compress
                        if ($latestAlarms.Count -eq 1 -and -not $json.StartsWith("[")) {
                            $json = "[$json]"
                        } elseif ($latestAlarms.Count -eq 0) {
                            $json = "[]"
                        }

                        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                        [System.IO.File]::WriteAllText($alarmsFile, $json, $utf8NoBom)
                        Write-Log "Alarm updated: $($alarm.id)"
                    }
                } catch {
                    Write-Log "Error updating alarm after popup: $_"
                }
            }
        } catch {
            Write-Log "Error in monitor loop: $_"
        }
    }

    # ===== ポモドーロ通知ファイルを処理 =====
    # pom_notif_<timestamp>.json が存在したらポップアップを表示して削除する。
    # alarms.json とは独立したファイルのため競合しない。
    $notifFiles = @(Get-ChildItem -Path $dataDirFull -Filter "pom_notif_*.json" -ErrorAction SilentlyContinue)
    foreach ($nf in $notifFiles) {
        try {
            $nc = [System.IO.File]::ReadAllText($nf.FullName, [System.Text.Encoding]::UTF8)
            $notif = $nc | ConvertFrom-Json
            Remove-Item $nf.FullName -Force
            Write-Log "Triggering pom notification: $($notif.title)"
            Show-BigAlarm -title $notif.title
            Write-Log "Pom notification popup closed."
        } catch {
            Write-Log "Error processing pom notification $($nf.Name): $_"
        }
    }

    Start-Sleep -Seconds 1
}
