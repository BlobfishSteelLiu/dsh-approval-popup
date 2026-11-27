# Always-on-top Agent status overlay for dsh-approval-popup.
# Custom-painted: no child controls, so resizing scales the whole card in one
# paint pass instead of re-laying out labels.
$ErrorActionPreference = 'Stop'

try {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshOverlayNative {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h);
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hWnd, IntPtr region, bool redraw);
}
'@
    [void][DshOverlayNative]::SetProcessDPIAware()

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $logHome = $env:DSH_HOME
    if ([string]::IsNullOrWhiteSpace($logHome)) { $logHome = Join-Path $HOME '.dsh' }
    $errorLog = Join-Path $logHome 'dsh-approval-popup\overlay-error.log'
    [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
    [System.Windows.Forms.Application]::add_ThreadException({
        param($sender, $args)
        try {
            [IO.File]::AppendAllText($errorLog, "$(Get-Date -Format o)`n$($args.Exception.ToString())`n`n")
        } catch {}
    })

    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public static class DshOverlayUi {
    public static GraphicsPath RoundRect(Rectangle rect, int radius) {
        var path = new GraphicsPath();
        int d = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
        if (d <= 0) { path.AddRectangle(rect); return path; }
        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

public class DshOverlayForm : Form {
    public DshOverlayForm() {
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.White;
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw, true);
        SetStyle(ControlStyles.AllPaintingInWmPaint, true);
        SetStyle(ControlStyles.OptimizedDoubleBuffer, true);
    }

    protected override bool ShowWithoutActivation {
        get { return true; }
    }

    protected override CreateParams CreateParams {
        get {
            var cp = base.CreateParams;
            cp.ClassStyle |= 0x00020000;
            cp.ExStyle |= 0x08000000;
            cp.ExStyle |= 0x00000080;
            return cp;
        }
    }
}
'@

    $dshHome = $env:DSH_HOME
    if ([string]::IsNullOrWhiteSpace($dshHome)) { $dshHome = Join-Path $HOME '.dsh' }
    $statePath = Join-Path $dshHome 'dsh-approval-popup\floating.json'
    $scale = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero).DpiX / 96
    $baseWidth = 480
    $baseHeight = 170
    $rowHeight = 58

    $iconPath = Join-Path $PSScriptRoot 'dsh.png'
    $script:icon = $null
    if (Test-Path $iconPath) {
        try { $script:icon = [System.Drawing.Image]::FromFile($iconPath) } catch { $script:icon = $null }
    }

    $form = New-Object DshOverlayForm
    $form.ClientSize = New-Object System.Drawing.Size([int]($baseWidth * $scale), [int]($baseHeight * $scale))

    $script:state = $null
    $script:expanded = $false
    $script:userWidth = $null
    $script:dots = 0
    $script:positioned = $false
    $script:resize = $null
    $script:startMouse = $null
    $script:startBounds = $null
    $script:fontCache = @{}
    $script:startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $script:layoutKey = ''

    $work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea

    function Get-Font([double]$size, [bool]$bold) {
        $size = [Math]::Round($size * 2) / 2
        $key = ('{0:N1}|{1}' -f $size, $bold)
        if (-not $script:fontCache.ContainsKey($key)) {
            $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
            $script:fontCache[$key] = New-Object System.Drawing.Font('Microsoft YaHei UI', $size, $style)
        }
        return $script:fontCache[$key]
    }

    function Apply-RoundRegion {
        if (-not $form.IsHandleCreated) { return }
        if ($form.Width -le 1 -or $form.Height -le 1) { return }
        $unit = $scale
        if ($form.Width -gt 0) { $unit = $form.Width / $baseWidth }
        $diameter = [int](36 * $unit)
        $region = [DshOverlayNative]::CreateRoundRectRgn(0, 0, $form.Width + 1, $form.Height + 1, $diameter, $diameter)
        [void][DshOverlayNative]::SetWindowRgn($form.Handle, $region, $false)
    }
    Apply-RoundRegion

    function Get-Ratio {
        $width = if ($null -ne $script:userWidth) { $script:userWidth } else { [double]$script:state.width }
        if ($width -lt 320) { $width = 320 }
        if ($width -gt 900) { $width = 900 }
        return $width / $baseWidth
    }

    function Set-WindowBounds([int]$x, [int]$y, [int]$w, [int]$h) {
        if (-not $form.IsHandleCreated) {
            $form.ClientSize = New-Object System.Drawing.Size($w, $h)
            $form.Left = $x
            $form.Top = $y
            return
        }
        [void][DshOverlayNative]::SetWindowPos($form.Handle, [IntPtr]::new(-1), $x, $y, $w, $h, 0x0014)
    }

    function Set-FormSize([string]$corner) {
        $state = $script:state
        if ($null -eq $state) { return }
        $sessions = Get-ActiveSessions $state
        $ratio = Get-Ratio
        $unit = $scale * $ratio
        $rows = if ($script:expanded -and $sessions.Count -gt 1) { $sessions.Count - 1 } else { 0 }
        $buttonSpace = if ($sessions.Count -gt 1) { 36 } else { 0 }
        $newWidth = [int]($baseWidth * $unit)
        $newHeight = [int](($baseHeight + $rows * $rowHeight + $buttonSpace) * $unit)
        if ($newWidth -lt 2 -or $newHeight -lt 2) { return }
        $left = $form.Left
        $top = $form.Top
        if (-not $script:positioned) {
            $left = $work.Right - $newWidth - [int](24 * $scale)
            $top = $work.Bottom - $newHeight - [int](24 * $scale)
            $script:positioned = $true
        }
        elseif ($null -ne $script:startBounds) {
            $start = $script:startBounds
            switch ($corner) {
                'tl' { $left = $start.Right - $newWidth; $top = $start.Bottom - $newHeight }
                'tr' { $left = $start.Left; $top = $start.Bottom - $newHeight }
                'bl' { $left = $start.Right - $newWidth; $top = $start.Top }
                default { $left = $start.Left; $top = $start.Top }
            }
        }
        $left = [Math]::Min([Math]::Max($left, $work.Left), $work.Right - $newWidth)
        $top = [Math]::Min([Math]::Max($top, $work.Top), $work.Bottom - $newHeight)
        Set-WindowBounds $left $top $newWidth $newHeight
        Apply-RoundRegion
        $form.Invalidate()
    }

    function Get-SessionTitle($session, $labels) {
        $value = [string]$session.title
        if ([string]::IsNullOrWhiteSpace($value) -or $value -match '^session-[0-9a-fA-F-]+$') {
            $value = [string]$labels.untitled
        }
        return $value
    }

    function Get-ActiveSessions($state) {
        if ($null -eq $state) { return @() }
        $idle = ([string][char]0x7A7A) + ([string][char]0x95F2)
        return @($state.sessions | Where-Object { [string]$_.status -ne $idle })
    }

    function Get-DropdownRect([double]$unit) {
        $width = [int](86 * $unit)
        $height = [int](28 * $unit)
        $x = [int]($form.Width - 24 * $unit - $width)
        $y = [int]($form.Height - 14 * $unit - $height)
        return New-Object System.Drawing.Rectangle($x, $y, $width, $height)
    }

    function Draw-Overlay($g) {
        $state = $script:state
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::White)
        $ratio = if ($form.Width -gt 0) { $form.Width / ($baseWidth * $scale) } else { 1 }
        $unit = $scale * $ratio
        $labels = if ($null -ne $state) { $state.labels } else { $null }
        $accentColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
        if ($null -ne $state -and -not [string]::IsNullOrWhiteSpace([string]$state.accent)) {
            try { $accentColor = [System.Drawing.ColorTranslator]::FromHtml([string]$state.accent) } catch {}
        }
        $accentBrush = New-Object System.Drawing.SolidBrush($accentColor)
        $g.FillRectangle($accentBrush, 0, 0, [int](8 * $unit), $form.Height)
        $accentBrush.Dispose()

        if ($null -ne $script:icon) {
            $rect = New-Object System.Drawing.Rectangle([int](18 * $unit), [int](18 * $unit), [int](84 * $unit), [int](84 * $unit))
            $g.DrawImage($script:icon, $rect)
        }

        $brandFont = Get-Font (7 * $ratio) $false
        $brandRect = New-Object System.Drawing.Rectangle([int](6 * $unit), [int](106 * $unit), [int](110 * $unit), [int](32 * $unit))
        $brandText = "DeepSeek`nHarness"
        [System.Windows.Forms.TextRenderer]::DrawText($g, $brandText, $brandFont, $brandRect, [System.Drawing.Color]::FromArgb(107, 114, 128), [System.Windows.Forms.TextFormatFlags]::HorizontalCenter -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter)

        $textX = [int](124 * $unit)
        $textWidth = [Math]::Max(1, [int]($form.Width - $textX - 24 * $unit))
        $titleFont = Get-Font (10.5 * $ratio) $true
        $statusFont = Get-Font (9.5 * $ratio) $false
        $smallFont = Get-Font (8.5 * $ratio) $false
        $primary = [System.Drawing.Color]::FromArgb(17, 24, 39)
        $secondary = [System.Drawing.Color]::FromArgb(107, 114, 128)
        $flags = [System.Windows.Forms.TextFormatFlags]::NoPrefix -bor [System.Windows.Forms.TextFormatFlags]::EndEllipsis -bor [System.Windows.Forms.TextFormatFlags]::SingleLine -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter
        $sep = [string][char]0x00B7
        $sessions = if ($null -ne $state) { Get-ActiveSessions $state } else { @() }
        $balanceText = if ($null -ne $state -and -not [string]::IsNullOrWhiteSpace([string]$state.balance)) { [string]$state.balance } else { '--' }
        $untitled = if ($null -ne $labels) { [string]$labels.untitled } else { 'Untitled' }

        if ($sessions.Count -eq 0) {
            $titleText = if ($null -ne $labels) { [string]$labels.noSessions } else { 'No active session' }
            $statusText = if ($null -ne $labels) { [string]$labels.waiting } else { 'Waiting for Agent' }
            $usageText = if ($null -ne $labels) { "$($labels.turn) 0 $($labels.round)  $sep  0 $($labels.tokens)" } else { '0 tokens' }
        }
        else {
            $top = $sessions[0]
            $topTitle = Get-SessionTitle $top $labels
            $model = [string]$top.model
            $titleText = if ([string]::IsNullOrWhiteSpace($model)) { $topTitle } else { "$topTitle  $sep  $model" }
            $dots = @('.', '. .', '. . .')[$script:dots % 3]
            $statusText = "$([string]$top.status) $dots"
            $tokens = [double]$top.tokens
            $tokenText = if ($tokens -ge 1000) { '{0:N1}K' -f ($tokens / 1000) } else { [string][int]$tokens }
            $usageText = if ($null -ne $labels) { "$($labels.turn) $($top.turns) $($labels.round)  $sep  $tokenText $($labels.tokens)" } else { "$tokenText tokens" }
            $balanceText = "$balanceText  $sep  $($state.period)"
        }

        $titleRect = New-Object System.Drawing.Rectangle($textX, [int](14 * $unit), $textWidth, [int](30 * $unit))
        [System.Windows.Forms.TextRenderer]::DrawText($g, $titleText, $titleFont, $titleRect, $primary, $flags)
        $statusRect = New-Object System.Drawing.Rectangle($textX, [int](44 * $unit), $textWidth, [int](28 * $unit))
        [System.Windows.Forms.TextRenderer]::DrawText($g, $statusText, $statusFont, $statusRect, $primary, $flags)
        $balanceRect = New-Object System.Drawing.Rectangle($textX, [int](74 * $unit), $textWidth, [int](24 * $unit))
        [System.Windows.Forms.TextRenderer]::DrawText($g, "$($labels.balance) $balanceText", $smallFont, $balanceRect, $secondary, $flags)
        $usageRect = New-Object System.Drawing.Rectangle($textX, [int](98 * $unit), $textWidth, [int](24 * $unit))
        [System.Windows.Forms.TextRenderer]::DrawText($g, $usageText, $smallFont, $usageRect, $secondary, $flags)

        if ($script:expanded -and $sessions.Count -gt 1) {
            for ($i = 1; $i -lt $sessions.Count; $i++) {
                $session = $sessions[$i]
                $rowTitle = Get-SessionTitle $session $labels
                $rowY = [int](($baseHeight + ($i - 1) * $rowHeight) * $unit)
                $lineY = $rowY - [int](10 * $unit)
                $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(226, 232, 240), 1)
                $g.DrawLine($linePen, $textX, $lineY, ($form.Width - [int](24 * $unit)), $lineY)
                $linePen.Dispose()
                $rowTitleRect = New-Object System.Drawing.Rectangle($textX, $rowY, $textWidth, [int](26 * $unit))
                $rowModel = [string]$session.model
                $rowText = if ([string]::IsNullOrWhiteSpace($rowModel)) { $rowTitle } else { "$rowTitle  $sep  $rowModel" }
                [System.Windows.Forms.TextRenderer]::DrawText($g, $rowText, $statusFont, $rowTitleRect, $primary, $flags)
                $rowStatusRect = New-Object System.Drawing.Rectangle($textX, ($rowY + [int](26 * $unit)), $textWidth, [int](22 * $unit))
                $rowStatus = "$([string]$session.status)  $sep  $($labels.turn) $($session.turns) $($labels.round)"
                [System.Windows.Forms.TextRenderer]::DrawText($g, $rowStatus, $smallFont, $rowStatusRect, $secondary, $flags)
            }
        }

        if ($sessions.Count -gt 1) {
            $button = Get-DropdownRect $unit
            $buttonPath = [DshOverlayUi]::RoundRect($button, [int](14 * $unit))
            $buttonBrush = New-Object System.Drawing.SolidBrush($accentColor)
            $g.FillPath($buttonBrush, $buttonPath)
            $buttonBrush.Dispose()
            $buttonPath.Dispose()
            $buttonText = if ($script:expanded) { "^  $($sessions.Count)" } else { "v  $($sessions.Count)" }
            [System.Windows.Forms.TextRenderer]::DrawText($g, $buttonText, $smallFont, $button, [System.Drawing.Color]::White, [System.Windows.Forms.TextFormatFlags]::HorizontalCenter -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter)
        }
    }

    $form.Add_Paint({
        param($sender, $e)
        try { Draw-Overlay $e.Graphics } catch {}
    })

    function Apply-State($state) {
        $script:state = $state
        $visible = ($state.enabled -eq $true) -and (($state.condition -eq 'always') -or ($state.appVisible -ne $true))
        if (-not $visible) {
            if ($form.Visible) { $form.Hide() }
            return
        }
        $ratio = Get-Ratio
        $sessions = Get-ActiveSessions $state
        $rows = if ($script:expanded -and $sessions.Count -gt 1) { $sessions.Count - 1 } else { 0 }
        $key = "$($state.width)|$($script:userWidth)|$($script:expanded)|$($sessions.Count)|$($state.accent)"
        if ($key -ne $script:layoutKey -or -not $script:positioned) {
            $script:layoutKey = $key
            Set-FormSize 'br'
        }
        else {
            $form.Invalidate()
        }
        if (-not $form.Visible) { $form.Show() }
        $form.TopMost = $true
        [void][DshOverlayNative]::ShowWindow($form.Handle, 4)
        [void][DshOverlayNative]::SetWindowPos($form.Handle, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0053)
    }

    $poll = New-Object System.Windows.Forms.Timer
    $poll.Interval = 700
    $poll.Add_Tick({
        try {
            if (-not (Test-Path $statePath)) { if ($form.Visible) { $form.Hide() }; return }
            $state = Get-Content -Raw -LiteralPath $statePath -Encoding UTF8 | ConvertFrom-Json
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            if ([double]$state.ts -lt ($script:startedAt - 10000)) {
                if ($form.Visible) { $form.Hide() }
                return
            }
            if (($now - [double]$state.ts) -gt 30000) { $form.Close(); return }
            Apply-State $state
        } catch {
            if ($form.Visible) { $form.Hide() }
        }
    })

    $animate = New-Object System.Windows.Forms.Timer
    $animate.Interval = 420
    $animate.Add_Tick({
        $script:dots++
        if ($form.Visible) { $form.Invalidate() }
    })

    $form.Add_MouseDown({
        param($sender, $e)
        if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
        $pos = $e.Location
        $corner = 22 * $scale
        $left = $pos.X -le $corner
        $right = $pos.X -ge ($form.Width - $corner)
        $top = $pos.Y -le $corner
        $bottom = $pos.Y -ge ($form.Height - $corner)
        $sessions = Get-ActiveSessions $script:state
        $unit = if ($form.Width -gt 0) { $form.Width / $baseWidth } else { $scale }
        if ($sessions.Count -gt 1) {
            $button = Get-DropdownRect $unit
            if ($button.Contains($pos)) {
                $script:expanded = -not $script:expanded
                $script:startBounds = $form.Bounds
                Set-FormSize 'br'
                $script:startBounds = $null
                return
            }
        }
        if (($left -or $right) -and ($top -or $bottom)) {
            $script:resize = if ($left -and $top) { 'tl' } elseif ($right -and $top) { 'tr' } elseif ($left -and $bottom) { 'bl' } else { 'br' }
            $script:startMouse = [System.Windows.Forms.Cursor]::Position
            $script:startBounds = $form.Bounds
            return
        }
        [void][DshOverlayNative]::ReleaseCapture()
        [void][DshOverlayNative]::SendMessage($form.Handle, 0xA1, [IntPtr]::new(2), [IntPtr]::Zero)
    })

    $form.Add_MouseMove({
        param($sender, $e)
        $pos = $e.Location
        $corner = 22 * $scale
        $isCorner = ($pos.X -le $corner -or $pos.X -ge ($form.Width - $corner)) -and ($pos.Y -le $corner -or $pos.Y -ge ($form.Height - $corner))
        $form.Cursor = if ($isCorner) { [System.Windows.Forms.Cursors]::SizeNWSE } else { [System.Windows.Forms.Cursors]::SizeAll }
        if ($null -eq $script:resize) { return }
        $delta = [System.Windows.Forms.Cursor]::Position
        $dx = $delta.X - $script:startMouse.X
        $sign = if ($script:resize -eq 'tr' -or $script:resize -eq 'br') { 1 } else { -1 }
        $newWidth = [Math]::Max(320 * $scale, $script:startBounds.Width + $sign * $dx)
        $script:userWidth = $newWidth / $scale
        Set-FormSize $script:resize
    })

    $form.Add_MouseUp({
        $script:resize = $null
        $script:startBounds = $null
        $script:startMouse = $null
        Apply-RoundRegion
        $form.Invalidate()
    })

    $form.Add_FormClosed({
        $poll.Stop(); $animate.Stop(); $poll.Dispose(); $animate.Dispose()
    })

    $poll.Start()
    $animate.Start()
    $context = New-Object System.Windows.Forms.ApplicationContext($form)
    [System.Windows.Forms.Application]::Run($context)
}
catch {
    try {
        $fallback = Join-Path $env:USERPROFILE '.dsh\dsh-approval-popup\overlay-error.log'
        [IO.File]::AppendAllText($fallback, "$(Get-Date -Format o)`n$($_.Exception.ToString())`n`n")
    } catch {}
    exit 3
}
