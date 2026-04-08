$baseDir = $PSScriptRoot

# 多重起動防止 (Mutex)
$mutexName = "Global\TaskflowAlarmMonitor_Mutex"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
    # 既に別の監視プロセスが起動しているため、静かに終了する
    exit
}
$configPath = Join-Path $baseDir "config.json"
$configContent = '{"userName":"Guest", "dataDirectoryPath":"./data"}'
if (Test-Path $configPath) {
    $configContent = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
}
$configObj = $configContent | ConvertFrom-Json
$dataDir = $configObj.dataDirectoryPath
if (-not $dataDir) {
    $dataDir = "./data"
}

$alarmsFile = Join-Path (Join-Path $baseDir $dataDir) "alarms.json"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-BigAlarm {
    param([string]$title)
    
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Taskflow Alarm"
    $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#1C212D")
    $form.Width = 800
    $form.Height = 600
    $form.StartPosition = "CenterScreen"
    $form.TopMost = $true
    $form.FormBorderStyle = "FixedDialog"

    $label = New-Object System.Windows.Forms.Label
    $label.Text = "【アラーム】`n" + $title
    $label.Font = New-Object System.Drawing.Font("Meiryo", 32, [System.Drawing.FontStyle]::Bold)
    $label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#E2E8F0")
    $label.AutoSize = $false
    $label.Dock = "Fill"
    $label.TextAlign = "MiddleCenter"
    $form.Controls.Add($label)

    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = "確認しました"
    $btn.Font = New-Object System.Drawing.Font("Meiryo", 16)
    $btn.Height = 80
    $btn.Dock = "Bottom"
    $btn.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#6366F1")
    $btn.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#FFFFFF")
    $btn.FlatStyle = "Flat"
    $btn.Add_Click({ $form.Close() })
    $form.Controls.Add($btn)

    $form.ShowDialog() | Out-Null
}

while ($true) {
    if (Test-Path $alarmsFile) {
        $content = [System.IO.File]::ReadAllText($alarmsFile, [System.Text.Encoding]::UTF8)
        try {
            $alarms = $content | ConvertFrom-Json
            $updated = $false
            $newAlarms = @()
            $now = Get-Date

            foreach ($alarm in $alarms) {
                if ($alarm.status -eq 'pending') {
                    $triggerTime = [DateTime]($alarm.triggerTime)
                    if ($now -ge $triggerTime) {
                        # Trigger Alarm! (Big popup window)
                        Show-BigAlarm -title $alarm.title
                        
                        $updated = $true
                        
                        # Add to history if it's recurring? Actually, we'll just update it or mark completed.
                        # We will copy the triggered alarm to history later if needed, but for now let's just make it completed or advance the time.
                        if ($alarm.recurrence -eq 'daily') {
                            $alarm.triggerTime = $triggerTime.AddDays(1).ToString("yyyy-MM-ddTHH:mm")
                        } elseif ($alarm.recurrence -eq 'weekly') {
                            $alarm.triggerTime = $triggerTime.AddDays(7).ToString("yyyy-MM-ddTHH:mm")
                        } elseif ($alarm.recurrence -eq 'monthly') {
                            $alarm.triggerTime = $triggerTime.AddMonths(1).ToString("yyyy-MM-ddTHH:mm")
                        } else {
                            $alarm.status = 'completed'
                        }
                    }
                }
                $newAlarms += $alarm
            }

            if ($updated) {
                # Save changes
                $json = $newAlarms | ConvertTo-Json -Depth 10 -Compress
                [System.IO.File]::WriteAllText($alarmsFile, $json, [System.Text.Encoding]::UTF8)
            }
        } catch {
            # In case of broken json or file lock, just ignore and retry on next tick
        }
    }
    
    Start-Sleep -Seconds 10
}
