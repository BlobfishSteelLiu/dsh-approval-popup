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
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
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
    public Font TitleFont;
    public Font BodyFont;
    public Font SmallFont;
    public Font PillFont;

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

    protected override void OnResize(EventArgs e) {
        base.OnResize(e);
        using (var path = DshToastUi.RoundRect(new Rectangle(0, 0, Width, Height), 18)) {
            var old = Region;
            Region = new Region(path);
            if (old != null) old.Dispose();
        }
    }

    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DshToastUi.RoundRect(rect, 18)) {
            using (var brush = new SolidBrush(SurfaceColor)) e.Graphics.FillPath(brush, path);
            using (var pen = new Pen(BorderColor, 1)) e.Graphics.DrawPath(pen, path);
        }
        using (var accentPath = DshToastUi.RoundRect(rect, 18)) {
            e.Graphics.SetClip(accentPath);
            using (var accentBrush = new SolidBrush(AccentColor)) e.Graphics.FillRectangle(accentBrush, 0, 0, 8, Height);
            e.Graphics.ResetClip();
        }

        int badgeX = 28;
        int badgeY = 50;
        using (var badge = new SolidBrush(AccentColor)) e.Graphics.FillEllipse(badge, badgeX, badgeY, 46, 46);
        using (var glyphPen = new Pen(AccentTextColor, 3.4f)) {
            float x = badgeX + 23f;
            e.Graphics.DrawLine(glyphPen, x, badgeY + 12f, x, badgeY + 25f);
            using (var dot = new SolidBrush(AccentTextColor)) e.Graphics.FillEllipse(dot, x - 3f, badgeY + 31f, 6, 6);
        }

        int textX = 92;
        int titleWidth = Width - textX - 28;
        using (var closePen = new Pen(MutedColor, 1.8f)) {
            e.Graphics.DrawLine(closePen, Width - 40, 28, Width - 26, 42);
            e.Graphics.DrawLine(closePen, Width - 26, 28, Width - 40, 42);
        }

        if (HighRisk && HighRiskLabel != "") {
            int pillWidth = 126;
            int pillX = Width - pillWidth - 56;
            int pillY = 26;
            using (var pillPath = DshToastUi.RoundRect(new Rectangle(pillX, pillY, pillWidth, 34), 17)) {
                using (var pillBrush = new SolidBrush(AccentColor)) e.Graphics.FillPath(pillBrush, pillPath);
            }
            TextRenderer.DrawText(e.Graphics, HighRiskLabel, PillFont, new Rectangle(pillX, pillY, pillWidth, 34), AccentTextColor, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            titleWidth = pillX - textX - 14;
        }

        TextRenderer.DrawText(e.Graphics, Header, TitleFont, new Rectangle(textX, 28, titleWidth, 42), TextColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(e.Graphics, Conversation, BodyFont, new Rectangle(textX, 76, Width - textX - 28, 38), TextColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(e.Graphics, Tool, SmallFont, new Rectangle(textX, 120, Width - textX - 28, 30), MutedColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(e.Graphics, Hint, SmallFont, new Rectangle(textX, 154, Width - textX - 28, 30), HighRisk ? AccentColor : MutedColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
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
    $form = New-Object DshToastForm
    $form.ClientSize = New-Object System.Drawing.Size(740, 220)
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
    $form.TitleFont = New-Object System.Drawing.Font($fontName, 12, [System.Drawing.FontStyle]::Bold)
    $form.BodyFont = New-Object System.Drawing.Font($fontName, 10.5, [System.Drawing.FontStyle]::Regular)
    $form.SmallFont = New-Object System.Drawing.Font($fontName, 9.5, [System.Drawing.FontStyle]::Regular)
    $form.PillFont = New-Object System.Drawing.Font($fontName, 9, [System.Drawing.FontStyle]::Bold)

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
    $finalTop = $workArea.Bottom - $form.Height - 16
    $form.Location = New-Object System.Drawing.Point(($workArea.Right + 4), $finalTop)

    function Activate-Dsh {
        $activated = $false
        try {
            $process = Get-Process -Id ([int]$payload.dshPid) -ErrorAction Stop
            if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
                [void][DshToastNative]::ShowWindow($process.MainWindowHandle, 9)
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
                    [void][DshToastNative]::ShowWindow($process.MainWindowHandle, 9)
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
        if ($eventArgs.X -ge ($form.Width - 56) -and $eventArgs.Y -le 56) {
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
