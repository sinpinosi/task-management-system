$baseDir = $PSScriptRoot

$configPath = Join-Path $baseDir "config.json"
$configContent = '{"userName":"Guest", "dataDirectoryPath":"./data", "port": 18080}'
if (Test-Path $configPath) {
    $configContent = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
}
$configObj = $configContent | ConvertFrom-Json
$port = $configObj.port
if (-not $port) {
    $port = 18080
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Start-Process "http://localhost:$port/"

Write-Host "========================================="
Write-Host " Local Task Management Server Started!"
Write-Host " Listening on http://localhost:$port/"
Write-Host " Please keep this window open."
Write-Host "========================================="

$baseDir = $PSScriptRoot

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # CORS
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        # Config Read
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

        # Ensure data folder exists
        $dataDirPath = Join-Path $baseDir $dataDir
        if (-not (Test-Path $dataDirPath)) {
            New-Item -ItemType Directory -Force -Path $dataDirPath | Out-Null
        }

        # Ensure templates folder exists
        $tmplDirPath = Join-Path $baseDir "templates"
        if (-not (Test-Path $tmplDirPath)) {
            New-Item -ItemType Directory -Force -Path $tmplDirPath | Out-Null
        }

        $path = $request.Url.LocalPath

        if ($path.StartsWith("/api/")) {
            $response.ContentType = "application/json"
            
            if ($request.HttpMethod -eq "GET" -and $path -eq "/api/config") {
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($configContent)
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($request.HttpMethod -eq "GET" -and $path -eq "/api/tasks") {
                $tasks = @()
                $files = Get-ChildItem -Path $dataDirPath -Filter "t_*.json"
                foreach ($file in $files) {
                    try {
                        $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
                        $null = $content | ConvertFrom-Json # simple validate
                        $tasks += $content
                    }
                    catch {
                        # Ignore invalid files
                    }
                }
                $resultJson = "[" + ($tasks -join ",") + "]"
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($resultJson)
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($request.HttpMethod -eq "GET" -and $path -eq "/api/templates") {
                $tmpls = @()
                if (Test-Path $tmplDirPath) {
                    $files = Get-ChildItem -Path $tmplDirPath -Filter "*.json"
                    foreach ($file in $files) {
                        try {
                            $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
                            $null = $content | ConvertFrom-Json
                            $tmpls += $content
                        }
                        catch { }
                    }
                }
                $resultJson = "[" + ($tmpls -join ",") + "]"
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($resultJson)
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($request.HttpMethod -eq "POST" -and $path.StartsWith("/api/tasks/")) {
                $taskId = $path.Substring(11)
                $taskId = $taskId -replace '[^a-zA-Z0-9_-]', ''
                if ($taskId) {
                    $sr = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                    $body = $sr.ReadToEnd()
                    $sr.Close()
                    
                    $outFile = Join-Path $dataDirPath "$taskId.json"
                    $utf8NoBom = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText($outFile, $body, $utf8NoBom)
                    
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                }
                else {
                    $response.StatusCode = 400
                }
            }
            elseif ($request.HttpMethod -eq "POST" -and $path.StartsWith("/api/templates/")) {
                $tplId = $path.Substring(15)
                $tplId = $tplId -replace '[^a-zA-Z0-9_-]', ''
                if ($tplId) {
                    $sr = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                    $body = $sr.ReadToEnd()
                    $sr.Close()
                    
                    $outFile = Join-Path $tmplDirPath "$tplId.json"
                    $utf8NoBom = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText($outFile, $body, $utf8NoBom)
                    
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                }
                else {
                    $response.StatusCode = 400
                }
            }
            elseif ($request.HttpMethod -eq "DELETE" -and $path.StartsWith("/api/templates/")) {
                $tplId = $path.Substring(15)
                $tplId = $tplId -replace '[^a-zA-Z0-9_-]', ''
                if ($tplId) {
                    $delFile = Join-Path $tmplDirPath "$tplId.json"
                    if (Test-Path $delFile) {
                        Remove-Item $delFile -Force
                    }
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                }
                else {
                    $response.StatusCode = 400
                }
            }
            elseif ($request.HttpMethod -eq "DELETE" -and $path.StartsWith("/api/tasks/")) {
                $taskId = $path.Substring(11)
                $taskId = $taskId -replace '[^a-zA-Z0-9_-]', ''
                if ($taskId) {
                    $delFile = Join-Path $dataDirPath "$taskId.json"
                    if (Test-Path $delFile) {
                        Remove-Item $delFile -Force
                    }
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                }
                else {
                    $response.StatusCode = 400
                }
            }
            elseif ($request.HttpMethod -eq "GET" -and $path -eq "/api/alarms") {
                $alarmsFile = Join-Path $dataDirPath "alarms.json"
                $resultJson = "[]"
                if (Test-Path $alarmsFile) {
                    $resultJson = [System.IO.File]::ReadAllText($alarmsFile, [System.Text.Encoding]::UTF8)
                }
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($resultJson)
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($request.HttpMethod -eq "POST" -and $path -eq "/api/alarms") {
                $sr = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $sr.ReadToEnd()
                $sr.Close()
                
                $alarmsFile = Join-Path $dataDirPath "alarms.json"
                $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                [System.IO.File]::WriteAllText($alarmsFile, $body, $utf8NoBom)
                
                $buffer = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($request.HttpMethod -eq "GET" -and $path -eq "/api/pomodoros") {
                $pomsFile = Join-Path $dataDirPath "pomodoros.json"
                $resultJson = "[]"
                if (Test-Path $pomsFile) {
                    $resultJson = [System.IO.File]::ReadAllText($pomsFile, [System.Text.Encoding]::UTF8)
                }
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($resultJson)
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($request.HttpMethod -eq "POST" -and $path -eq "/api/pomodoros") {
                $sr = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $sr.ReadToEnd()
                $sr.Close()
                
                $pomsFile = Join-Path $dataDirPath "pomodoros.json"
                $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                [System.IO.File]::WriteAllText($pomsFile, $body, $utf8NoBom)
                
                $buffer = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            else {
                $response.StatusCode = 404
            }
        }
        else {
            # Serve Static Files
            if ($path -eq "/") { $path = "/index.html" }
            $filePath = Join-Path $baseDir "public$path"
            
            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                switch ($ext) {
                    ".html" { $response.ContentType = "text/html; charset=utf-8" }
                    ".css" { $response.ContentType = "text/css; charset=utf-8" }
                    ".js" { $response.ContentType = "application/javascript; charset=utf-8" }
                    default { $response.ContentType = "application/octet-stream" }
                }
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            else {
                $response.StatusCode = 404
            }
        }
        
        $response.Close()
    }
    catch {
        # Catch errors so server doesn't crash on bad requests
        Write-Host "Error processing request: $_"
    }
}


