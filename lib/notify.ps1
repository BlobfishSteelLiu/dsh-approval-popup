# Native Windows toast-style approval notice for dsh-approval-popup.
#
# This window is informational only: clicking it brings DeepSeek Harness to the
# foreground, where the normal in-app modal handles the approval. The payload
# path is passed in DSH_APPROVAL_PAYLOAD. The process exits by itself.
$ErrorActionPreference = 'Stop'

try {
    Add-Type @'
using System.Runtime.InteropServices;
public static class DshDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
    [void][DshDpi]::SetProcessDPIAware()

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName Microsoft.VisualBasic
    [System.Windows.Forms.Application]::EnableVisualStyles()

    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshToastNative {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool on);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref DshWindowPlacement placement);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}

[StructLayout(LayoutKind.Sequential)]
public struct DshPoint {
    public int X;
    public int Y;
}

[StructLayout(LayoutKind.Sequential)]
public struct DshRect {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

[StructLayout(LayoutKind.Sequential)]
public struct DshWindowPlacement {
    public uint length;
    public uint flags;
    public uint showCmd;
    public DshPoint ptMinPosition;
    public DshPoint ptMaxPosition;
    public DshRect rcNormalPosition;
}
'@

    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public static class DshToastUi {
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

public class DshToastForm : Form {
    public float LayoutScale = 1f;
    public Color AccentColor = Color.FromArgb(37, 99, 235);
    public Color AccentTextColor = Color.White;
    public Color SurfaceColor = Color.White;
    public Color BorderColor = Color.FromArgb(226, 232, 240);
    public Color TextColor = Color.FromArgb(15, 23, 42);
    public Color MutedColor = Color.FromArgb(100, 116, 139);
    public string Header = "";
    public string Conversation = "";
    public string Tool = "";
    public string HighRiskLabel = "";
    public string Hint = "";
    public bool HighRisk = false;
    public bool Question = false;
    public Font TitleFont;
    public Font BodyFont;
    public Font SmallFont;
    public Font PillFont;
    public Font BadgeFont;

    public DshToastForm() {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw, true);
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

    private int S(int value) {
        return (int)Math.Round(value * LayoutScale);
    }

    protected override void OnResize(EventArgs e) {
        base.OnResize(e);
        using (var path = DshToastUi.RoundRect(new Rectangle(0, 0, Width, Height), S(18))) {
            var old = Region;
            Region = new Region(path);
            if (old != null) old.Dispose();
        }
    }

    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DshToastUi.RoundRect(rect, S(18))) {
            using (var brush = new SolidBrush(SurfaceColor)) e.Graphics.FillPath(brush, path);
            using (var pen = new Pen(BorderColor, 1)) e.Graphics.DrawPath(pen, path);
        }
        using (var accentPath = DshToastUi.RoundRect(rect, S(18))) {
            e.Graphics.SetClip(accentPath);
            using (var accentBrush = new SolidBrush(AccentColor)) e.Graphics.FillRectangle(accentBrush, 0, 0, S(8), Height);
            e.Graphics.ResetClip();
        }

        int padX = S(52);
        int textX = S(120);
        int contentRight = Width - S(56);
        int titleY = S(40);
        int titleH = TitleFont.Height + S(10);
        int bodyH = BodyFont.Height + S(8);
        int smallH = SmallFont.Height + S(6);
        int bodyY = titleY + titleH + S(2);
        int toolY = bodyY + bodyH + S(2);
        int hintY = toolY + smallH + S(2);
        int badgeX = padX;
        int badgeY = titleY + (Question ? S(5) : S(8));
        int badgeSize = S(Question ? 60 : 52);
        using (var badge = new SolidBrush(AccentColor)) e.Graphics.FillEllipse(badge, badgeX, badgeY, badgeSize, badgeSize);
        if (Question) {
            TextRenderer.DrawText(
                e.Graphics,
                "?",
                BadgeFont,
                new Rectangle(badgeX + S(2), badgeY + S(1), badgeSize, badgeSize),
                AccentTextColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix
            );
        }
        else {
            using (var glyphPen = new Pen(AccentTextColor, 3.8f * LayoutScale)) {
                float x = badgeX + S(26);
                e.Graphics.DrawLine(glyphPen, x, badgeY + S(14), x, badgeY + S(29));
                using (var dot = new SolidBrush(AccentTextColor)) e.Graphics.FillEllipse(dot, x - S(4), badgeY + S(35), S(7), S(7));
            }
        }

        int titleWidth = contentRight - textX;
        using (var closePen = new Pen(MutedColor, 1.8f * LayoutScale)) {
            e.Graphics.DrawLine(closePen, Width - S(52), S(42), Width - S(38), S(56));
            e.Graphics.DrawLine(closePen, Width - S(38), S(42), Width - S(52), S(56));
        }

        if (HighRisk && HighRiskLabel != "") {
            int pillHeight = PillFont.Height + S(10);
            int pillWidth = TextRenderer.MeasureText(HighRiskLabel, PillFont).Width + S(28);
            int pillX = Width - pillWidth - S(72);
            int pillY = titleY;
            using (var pillPath = DshToastUi.RoundRect(new Rectangle(pillX, pillY, pillWidth, pillHeight), pillHeight / 2)) {
                using (var pillBrush = new SolidBrush(AccentColor)) e.Graphics.FillPath(pillBrush, pillPath);
            }
            TextRenderer.DrawText(e.Graphics, HighRiskLabel, PillFont, new Rectangle(pillX, pillY, pillWidth, pillHeight), AccentTextColor, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            titleWidth = pillX - textX - S(16);
        }

        TextRenderer.DrawText(e.Graphics, Header, TitleFont, new Rectangle(textX, titleY, titleWidth, titleH), TextColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(e.Graphics, Conversation, BodyFont, new Rectangle(textX, bodyY, contentRight - textX, bodyH), TextColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(e.Graphics, Tool, SmallFont, new Rectangle(textX, toolY, contentRight - textX, smallH), MutedColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(e.Graphics, Hint, SmallFont, new Rectangle(textX, hintY, contentRight - textX, smallH), HighRisk ? AccentColor : MutedColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }
}
'@

    $payload = Get-Content -Raw -LiteralPath $env:DSH_APPROVAL_PAYLOAD -Encoding UTF8 | ConvertFrom-Json
    $highRisk = [bool]$payload.highRisk
    $accent = [System.Drawing.ColorTranslator]::FromHtml([string]$payload.accentColor)
    $accentText = [System.Drawing.ColorTranslator]::FromHtml([string]$payload.accentTextColor)
    $surface = if ($highRisk) { [System.Drawing.Color]::FromArgb(255, 245, 245) } else { [System.Drawing.Color]::White }
    $border = if ($highRisk) { [System.Drawing.Color]::FromArgb(254, 202, 202) } else { [System.Drawing.Color]::FromArgb(226, 232, 240) }

    $fontName = if ($payload.lang -eq 'zh') { 'Microsoft YaHei UI' } else { 'Segoe UI' }
    $dpiScale = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero).DpiX / 96
    $layoutScale = $dpiScale / 2.25
    $form = New-Object DshToastForm
    $form.LayoutScale = $layoutScale
    $form.ClientSize = New-Object System.Drawing.Size(
        [int][Math]::Round(980 * $layoutScale),
        [int][Math]::Round(292 * $layoutScale)
    )
    $form.AccentColor = $accent
    $form.AccentTextColor = $accentText
    $form.SurfaceColor = $surface
    $form.BorderColor = $border
    $form.TextColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $form.MutedColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
    $form.Header = [string]$payload.title
    $form.Conversation = [string]$payload.conversation
    $form.Tool = ([string]$payload.toolLabel) + [string]$payload.tool
    $form.HighRiskLabel = [string]$payload.highRiskLabel
    $form.Hint = [string]$payload.hint
    $form.HighRisk = $highRisk
    $form.Question = ([string]$payload.kind -eq 'question')
    $form.TitleFont = New-Object System.Drawing.Font($fontName, 12, [System.Drawing.FontStyle]::Bold)
    $form.BodyFont = New-Object System.Drawing.Font($fontName, 10.5, [System.Drawing.FontStyle]::Regular)
    $form.SmallFont = New-Object System.Drawing.Font($fontName, 9.5, [System.Drawing.FontStyle]::Regular)
    $form.PillFont = New-Object System.Drawing.Font($fontName, 9, [System.Drawing.FontStyle]::Bold)
    $form.BadgeFont = New-Object System.Drawing.Font($fontName, 17, [System.Drawing.FontStyle]::Bold)

    $targetScreen = $null
    try {
        $process = Get-Process -Id ([int]$payload.dshPid) -ErrorAction Stop
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
            $targetScreen = [System.Windows.Forms.Screen]::FromHandle($process.MainWindowHandle)
        }
    }
    catch { }
    if ($null -eq $targetScreen) {
        try {
            $process = Get-Process -Name 'DeepSeek Harness' -ErrorAction Stop |
                Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
                Select-Object -First 1
            if ($null -ne $process) {
                $targetScreen = [System.Windows.Forms.Screen]::FromHandle($process.MainWindowHandle)
            }
        }
        catch { }
    }
    if ($null -eq $targetScreen) {
        $targetScreen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
    }
    $workArea = $targetScreen.WorkingArea
    $finalLeft = $workArea.Right - $form.Width - 16
    $finalTop = $workArea.Bottom - $form.Height - [int][Math]::Round(40 * $layoutScale)
    $form.Location = New-Object System.Drawing.Point(($workArea.Right + 4), $finalTop)

    function Test-Maximized([IntPtr]$handle) {
        if ([DshToastNative]::IsZoomed($handle)) { return $true }
        $placement = New-Object DshWindowPlacement
        $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
        if ([DshToastNative]::GetWindowPlacement($handle, [ref]$placement)) {
            return (($placement.showCmd -eq 3) -or (($placement.flags -band 2) -ne 0))
        }
        return $false
    }

    function Activate-Dsh {
        $activated = $false
        try {
            $process = Get-Process -Id ([int]$payload.dshPid) -ErrorAction Stop
            if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
                $showCommand = if (Test-Maximized $process.MainWindowHandle) { 3 } else { 9 }
                [void][DshToastNative]::ShowWindow($process.MainWindowHandle, $showCommand)
                [void][DshToastNative]::SetForegroundWindow($process.MainWindowHandle)
                $activated = $true
            }
        }
        catch { }
        if (-not $activated) {
            try {
                $process = Get-Process -Name 'DeepSeek Harness' -ErrorAction Stop |
                    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
                    Select-Object -First 1
                if ($null -ne $process) {
                    $showCommand = if (Test-Maximized $process.MainWindowHandle) { 3 } else { 9 }
                    [void][DshToastNative]::ShowWindow($process.MainWindowHandle, $showCommand)
                    [void][DshToastNative]::SetForegroundWindow($process.MainWindowHandle)
                    $activated = $true
                }
            }
            catch { }
        }
        if (-not $activated) {
            try { [void][Microsoft.VisualBasic.Interaction]::AppActivate([int]$payload.dshPid) } catch { }
        }
        if (-not $activated -and -not [string]::IsNullOrWhiteSpace([string]$payload.dshUrl)) {
            try { Start-Process ([string]$payload.dshUrl) } catch { }
        }
    }

    $state = @{ phase = 'in'; ticks = 0; left = $form.Left }
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 15
    $timer.Add_Tick({
        if ($state.phase -eq 'in') {
            $state.left -= 26
            if ($state.left -le $finalLeft) {
                $state.left = $finalLeft
                $state.phase = 'hold'
                $state.ticks = 0
            }
            $form.Left = $state.left
        }
        elseif ($state.phase -eq 'hold') {
            $state.ticks++
            if (($state.ticks % 40) -eq 0) {
                [void][DshToastNative]::SetWindowPos($form.Handle, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0053)
            }
            if ($state.ticks -ge 330) {
                $state.phase = 'out'
            }
        }
        else {
            $state.left += 26
            $form.Left = $state.left
            if ($state.left -gt $workArea.Right) {
                $timer.Stop()
                $form.Close()
            }
        }
    })
    $form.Add_Shown({
        $form.TopMost = $true
        [void][DshToastNative]::ShowWindow($form.Handle, 4)
        [void][DshToastNative]::SetWindowPos($form.Handle, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0053)
        [void][DshToastNative]::BringWindowToTop($form.Handle)
        $timer.Start()
    })
    $form.Add_MouseDown({
        param($sender, $eventArgs)
        $timer.Stop()
        $closeWidth = [int][Math]::Round(68 * $form.LayoutScale)
        $closeHeight = [int][Math]::Round(80 * $form.LayoutScale)
        if ($eventArgs.X -ge ($form.Width - $closeWidth) -and $eventArgs.Y -le $closeHeight) {
            $form.Close()
            return
        }
        Activate-Dsh
        $form.Close()
    })
    $form.Add_FormClosed({
        $timer.Stop()
        $timer.Dispose()
    })

    [void]$form.ShowDialog()
    exit 0
}
catch {
    exit 3
}
