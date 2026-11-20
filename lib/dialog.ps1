# Native Windows approval dialog for dsh-approval-popup.
#
# The host writes a UTF-8 JSON payload and passes its path in
# DSH_APPROVAL_PAYLOAD. Exit code 6 = allow once, 7 = reject, anything else =
# the dialog could not be shown (the host falls back to the browser approval UI).
$ErrorActionPreference = 'Stop'

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName Microsoft.VisualBasic
    [System.Windows.Forms.Application]::EnableVisualStyles()

    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshApprovalNative {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool on);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
}
'@

    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public static class DshUi {
    public static GraphicsPath RoundRect(Rectangle rect, int radius) {
        var path = new GraphicsPath();
        int d = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
        if (d <= 0) {
            path.AddRectangle(rect);
            return path;
        }
        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

public class DshApprovalForm : Form {
    public Func<Keys, bool> KeyInterceptor;
    public Color AccentColor = Color.FromArgb(37, 99, 235);
    public Color SurfaceColor = Color.FromArgb(248, 250, 252);
    public Color BorderColor = Color.FromArgb(226, 232, 240);
    public int CornerRadius = 18;
    public int AccentHeight = 6;

    public DshApprovalForm() {
        FormBorderStyle = FormBorderStyle.None;
        BackColor = SurfaceColor;
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw, true);
    }

    protected override CreateParams CreateParams {
        get {
            var cp = base.CreateParams;
            cp.ClassStyle |= 0x00020000;
            return cp;
        }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData) {
        var handler = KeyInterceptor;
        if (handler != null && handler(keyData)) return true;
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void OnResize(EventArgs e) {
        base.OnResize(e);
        using (var path = DshUi.RoundRect(new Rectangle(0, 0, Width, Height), CornerRadius)) {
            var old = Region;
            Region = new Region(path);
            if (old != null) old.Dispose();
        }
    }

    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DshUi.RoundRect(rect, CornerRadius)) {
            using (var pen = new Pen(BorderColor, 1)) e.Graphics.DrawPath(pen, path);
            e.Graphics.SetClip(path);
            using (var brush = new SolidBrush(AccentColor)) e.Graphics.FillRectangle(brush, 0, 0, Width, AccentHeight);
            e.Graphics.ResetClip();
        }
    }
}

public class DshBadge : Control {
    public Color FillColor = Color.FromArgb(37, 99, 235);
    public Color GlyphColor = Color.White;

    public DshBadge() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Size = new Size(44, 44);
    }

    protected override void OnPaintBackground(PaintEventArgs e) {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : SystemColors.Control);
    }

    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : SystemColors.Control);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var brush = new SolidBrush(FillColor)) e.Graphics.FillEllipse(brush, 0, 0, Width - 1, Height - 1);
        using (var pen = new Pen(GlyphColor, 3)) {
            float x = Width / 2f;
            e.Graphics.DrawLine(pen, x, Height * 0.28f, x, Height * 0.58f);
            using (var dot = new SolidBrush(GlyphColor)) e.Graphics.FillEllipse(dot, x - 2, Height * 0.70f, 4, 4);
        }
    }
}

public class DshPill : Control {
    public Color FillColor = Color.FromArgb(239, 246, 255);
    public Color TextColor = Color.FromArgb(29, 78, 216);
    public int Radius = 12;

    public DshPill() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }

    protected override void OnPaintBackground(PaintEventArgs e) {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : SystemColors.Control);
    }

    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : SystemColors.Control);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DshUi.RoundRect(rect, Radius)) {
            using (var brush = new SolidBrush(FillColor)) e.Graphics.FillPath(brush, path);
        }
        TextRenderer.DrawText(e.Graphics, Text, Font, rect, TextColor, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
    }
}

public class DshCardPanel : Panel {
    public Color FillColor = Color.White;
    public Color BorderColor = Color.FromArgb(226, 232, 240);
    public int Radius = 12;

    public DshCardPanel() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Color.Transparent;
    }

    protected override void OnPaintBackground(PaintEventArgs e) {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : Color.White);
    }

    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DshUi.RoundRect(rect, Radius)) {
            using (var brush = new SolidBrush(FillColor)) e.Graphics.FillPath(brush, path);
            using (var pen = new Pen(BorderColor, 1)) e.Graphics.DrawPath(pen, path);
        }
    }
}

public class DshRoundButton : Button {
    public int Radius = 18;
    public Color FillColor = Color.FromArgb(37, 99, 235);
    public Color HoverColor = Color.FromArgb(29, 78, 216);
    public Color BorderColor = Color.Transparent;
    public Color TextColor = Color.White;
    private bool hover;

    public DshRoundButton() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        Cursor = Cursors.Hand;
    }

    protected override void OnPaintBackground(PaintEventArgs e) {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : SystemColors.Control);
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : SystemColors.Control);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = DshUi.RoundRect(rect, Radius)) {
            using (var brush = new SolidBrush(hover && Enabled ? HoverColor : FillColor)) e.Graphics.FillPath(brush, path);
            if (BorderColor.A > 0) {
                using (var pen = new Pen(BorderColor, 1)) e.Graphics.DrawPath(pen, path);
            }
        }
        if (Focused) {
            using (var focusPath = DshUi.RoundRect(rect, Radius)) {
                using (var pen = new Pen(Color.FromArgb(245, 158, 11), 2)) e.Graphics.DrawPath(pen, focusPath);
            }
        }
        var color = Enabled ? TextColor : Color.FromArgb(148, 163, 184);
        TextRenderer.DrawText(e.Graphics, Text, Font, rect, color, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
    }
}
'@

    $payload = Get-Content -Raw -LiteralPath $env:DSH_APPROVAL_PAYLOAD -Encoding UTF8 | ConvertFrom-Json
    $highRisk = [bool]$payload.highRisk

    if ([string]::IsNullOrWhiteSpace([string]$payload.conversationLabel)) { $payload.conversationLabel = 'Conversation' }
    if ([string]::IsNullOrWhiteSpace([string]$payload.workspaceLabel)) { $payload.workspaceLabel = 'Workspace' }
    if ([string]::IsNullOrWhiteSpace([string]$payload.conversation)) { $payload.conversation = [string]$payload.title }

    if ($highRisk) {
        $accent = [System.Drawing.Color]::FromArgb(220, 38, 38)
        $accentText = [System.Drawing.Color]::White
        $surface = [System.Drawing.Color]::FromArgb(255, 245, 245)
        $border = [System.Drawing.Color]::FromArgb(254, 202, 202)
        $titleColor = [System.Drawing.Color]::FromArgb(153, 27, 27)
        $bodyColor = [System.Drawing.Color]::FromArgb(127, 29, 29)
        $mutedColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
    }
    else {
        $accentHex = [string]$payload.accentColor
        if ([string]::IsNullOrWhiteSpace($accentHex)) { $accentHex = '#1D4ED8' }
        $accentTextHex = [string]$payload.accentTextColor
        if ([string]::IsNullOrWhiteSpace($accentTextHex)) { $accentTextHex = '#FFFFFF' }
        $accent = [System.Drawing.ColorTranslator]::FromHtml($accentHex)
        $accentText = [System.Drawing.ColorTranslator]::FromHtml($accentTextHex)
        $surface = [System.Drawing.Color]::FromArgb(248, 250, 252)
        $border = [System.Drawing.Color]::FromArgb(226, 232, 240)
        $titleColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
        $bodyColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
        $mutedColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
    }

    $fontName = if ($payload.lang -eq 'zh') { 'Microsoft YaHei UI' } else { 'Segoe UI' }
    $titleFont = New-Object System.Drawing.Font($fontName, 15, [System.Drawing.FontStyle]::Bold)
    $subtitleFont = New-Object System.Drawing.Font($fontName, 9.5, [System.Drawing.FontStyle]::Regular)
    $labelFont = New-Object System.Drawing.Font($fontName, 8.5, [System.Drawing.FontStyle]::Regular)
    $valueFont = New-Object System.Drawing.Font($fontName, 9.5, [System.Drawing.FontStyle]::Regular)
    $buttonFont = New-Object System.Drawing.Font($fontName, 9.5, [System.Drawing.FontStyle]::Bold)

    $form = New-Object DshApprovalForm
    $form.Text = [string]$payload.title
    $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    $form.AutoScaleDimensions = New-Object System.Drawing.SizeF(96, 96)
    $form.ClientSize = New-Object System.Drawing.Size(620, 470)
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $workArea = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
    $left = $workArea.Left + [int](($workArea.Width - $form.Width) / 2)
    $top = $workArea.Top + [int](($workArea.Height - $form.Height) / 2)
    if ($left -lt $workArea.Left) { $left = $workArea.Left }
    if ($top -lt $workArea.Top) { $top = $workArea.Top }
    $form.Location = New-Object System.Drawing.Point($left, $top)
    $form.ShowInTaskbar = $true
    $form.TopMost = $true
    $form.Font = $subtitleFont
    $iconPath = Join-Path $PSScriptRoot 'icon.ico'
    if (Test-Path $iconPath) {
        try { $form.Icon = New-Object System.Drawing.Icon($iconPath) } catch { }
    }
    $form.AccentColor = $accent
    $form.SurfaceColor = $surface
    $form.BorderColor = $border
    $form.BackColor = $surface

    $badge = New-Object DshBadge
    $badge.Location = New-Object System.Drawing.Point(28, 30)
    $badge.Size = New-Object System.Drawing.Size(44, 44)
    $badge.FillColor = $accent
    $badge.GlyphColor = $accentText

    $title = New-Object System.Windows.Forms.Label
    $title.Location = New-Object System.Drawing.Point(88, 26)
    $title.Size = New-Object System.Drawing.Size(400, 30)
    $title.Font = $titleFont
    $title.ForeColor = $titleColor
    $title.AutoEllipsis = $true
    if ([string]::IsNullOrWhiteSpace([string]$payload.dialogTitle)) {
        $title.Text = [string]$payload.title
    }
    else {
        $title.Text = [string]$payload.dialogTitle
    }

    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Location = New-Object System.Drawing.Point(88, 58)
    $subtitle.Size = New-Object System.Drawing.Size(500, 40)
    $subtitle.Font = $subtitleFont
    $subtitle.ForeColor = $bodyColor
    $subtitle.Text = [string]$payload.header

    if ($highRisk) {
        $pill = New-Object DshPill
        $pill.Location = New-Object System.Drawing.Point(500, 30)
        $pill.Size = New-Object System.Drawing.Size(92, 24)
        $pill.FillColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
        $pill.TextColor = [System.Drawing.Color]::White
        $pill.Font = New-Object System.Drawing.Font($fontName, 8.5, [System.Drawing.FontStyle]::Bold)
        $pill.Text = [string]$payload.highRiskLabel
        if ([string]::IsNullOrWhiteSpace($pill.Text)) { $pill.Text = 'HIGH RISK' }
        $form.Controls.Add($pill)
    }

    $divider = New-Object System.Windows.Forms.Panel
    $divider.Location = New-Object System.Drawing.Point(28, 112)
    $divider.Size = New-Object System.Drawing.Size(564, 1)
    $divider.BackColor = $border

    $labels = @()
    $values = @()
    $meta = @(
        @{ Label = [string]$payload.conversationLabel; Value = [string]$payload.conversation },
        @{ Label = [string]$payload.workspaceLabel; Value = [string]$payload.workspace }
    )
    $y = 128
    foreach ($item in $meta) {
        $label = New-Object System.Windows.Forms.Label
        $label.Location = New-Object System.Drawing.Point(28, $y)
        $label.Size = New-Object System.Drawing.Size(64, 20)
        $label.Font = $labelFont
        $label.ForeColor = $mutedColor
        $label.Text = $item.Label
        $labels += $label

        $valueY = $y - 1
        $value = New-Object System.Windows.Forms.Label
        $value.Location = New-Object System.Drawing.Point(96, $valueY)
        $value.Size = New-Object System.Drawing.Size(496, 22)
        $value.Font = $valueFont
        $value.ForeColor = $bodyColor
        $value.AutoEllipsis = $true
        $value.Text = $item.Value
        $values += $value
        $y += 30
    }

    $toolLabel = New-Object System.Windows.Forms.Label
    $toolLabel.Location = New-Object System.Drawing.Point(28, $y)
    $toolLabel.Size = New-Object System.Drawing.Size(64, 20)
    $toolLabel.Font = $labelFont
    $toolLabel.ForeColor = $mutedColor
    $toolLabel.Text = [string]$payload.toolLabel

    $toolPillY = $y - 2
    $toolPill = New-Object DshPill
    $toolPill.Location = New-Object System.Drawing.Point(96, $toolPillY)
    $toolPill.Size = New-Object System.Drawing.Size(180, 24)
    $toolPill.Font = New-Object System.Drawing.Font($fontName, 8.5, [System.Drawing.FontStyle]::Regular)
    $toolPill.Text = [string]$payload.tool
    if ($highRisk) {
        $toolPill.FillColor = [System.Drawing.Color]::FromArgb(254, 226, 226)
        $toolPill.TextColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
    }
    else {
        $toolPill.FillColor = [System.Drawing.Color]::FromArgb(239, 246, 255)
        $toolPill.TextColor = [System.Drawing.Color]::FromArgb(29, 78, 216)
    }

    $reasonLabel = New-Object System.Windows.Forms.Label
    $reasonLabel.Location = New-Object System.Drawing.Point(28, 222)
    $reasonLabel.Size = New-Object System.Drawing.Size(564, 20)
    $reasonLabel.Font = New-Object System.Drawing.Font($fontName, 9, [System.Drawing.FontStyle]::Bold)
    $reasonLabel.ForeColor = $titleColor
    $reasonLabel.Text = [string]$payload.reasonLabel

    $reasonCard = New-Object DshCardPanel
    $reasonCard.Location = New-Object System.Drawing.Point(28, 246)
    $reasonCard.Size = New-Object System.Drawing.Size(564, 150)
    $reasonCard.FillColor = [System.Drawing.Color]::White
    $reasonCard.BorderColor = $border

    $reasonBox = New-Object System.Windows.Forms.TextBox
    $reasonBox.Location = New-Object System.Drawing.Point(12, 12)
    $reasonBox.Size = New-Object System.Drawing.Size(540, 126)
    $reasonBox.Multiline = $true
    $reasonBox.ReadOnly = $true
    $reasonBox.WordWrap = $true
    if (([string]$payload.reason).Length -gt 360) {
        $reasonBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
    }
    else {
        $reasonBox.ScrollBars = [System.Windows.Forms.ScrollBars]::None
    }
    $reasonBox.BorderStyle = [System.Windows.Forms.BorderStyle]::None
    $reasonBox.BackColor = [System.Drawing.Color]::White
    $reasonBox.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $reasonBox.Font = New-Object System.Drawing.Font($fontName, 9.5, [System.Drawing.FontStyle]::Regular)
    $reasonBox.Text = [string]$payload.reason
    $reasonBox.TabStop = $false
    $reasonCard.Controls.Add($reasonBox)

    $hint = New-Object System.Windows.Forms.Label
    $hint.Location = New-Object System.Drawing.Point(28, 400)
    $hint.Size = New-Object System.Drawing.Size(288, 38)
    $hint.Font = $labelFont
    $hint.ForeColor = $mutedColor
    $hint.Text = [string]$payload.hint

    $rejectButton = New-Object DshRoundButton
    $rejectButton.Location = New-Object System.Drawing.Point(326, 400)
    $rejectButton.Size = New-Object System.Drawing.Size(130, 40)
    $rejectButton.Text = [string]$payload.reject
    $rejectButton.Font = $buttonFont
    $rejectButton.Radius = 20
    $rejectButton.FillColor = [System.Drawing.Color]::White
    $rejectButton.HoverColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
    $rejectButton.TextColor = $bodyColor
    $rejectButton.BorderColor = $border
    $rejectButton.TabIndex = 1

    $allowButton = New-Object DshRoundButton
    $allowButton.Location = New-Object System.Drawing.Point(468, 400)
    $allowButton.Size = New-Object System.Drawing.Size(130, 40)
    $allowButton.Text = [string]$payload.allow
    $allowButton.Font = $buttonFont
    $allowButton.Radius = 20
    $allowButton.FillColor = $accent
    if ($highRisk) {
        $allowButton.HoverColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
    }
    else {
        $allowButton.HoverColor = [System.Drawing.Color]::FromArgb(29, 78, 216)
    }
    $allowButton.TextColor = $accentText
    $allowButton.BorderColor = [System.Drawing.Color]::Transparent
    $allowButton.TabIndex = 0

    if ($highRisk) {
        $rejectButton.BorderColor = [System.Drawing.Color]::FromArgb(252, 165, 165)
        $rejectButton.TextColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
        $allowButton.TabStop = $false
    }

    $allowButton.Add_Click({
        $form.DialogResult = [System.Windows.Forms.DialogResult]::Yes
        $form.Close()
    })
    $rejectButton.Add_Click({
        $form.DialogResult = [System.Windows.Forms.DialogResult]::No
        $form.Close()
    })

    $state = @{ selected = 'reject' }
    $rejectButton.Add_Enter({ $state.selected = 'reject' })
    $allowButton.Add_Enter({ $state.selected = 'allow' })

    $form.KeyInterceptor = [Func[System.Windows.Forms.Keys, bool]]{
        param($keyData)
        $key = $keyData -band [System.Windows.Forms.Keys]::KeyCode
        if ($highRisk) {
            if ($key -in @(
                [System.Windows.Forms.Keys]::Enter,
                [System.Windows.Forms.Keys]::Space,
                [System.Windows.Forms.Keys]::Left,
                [System.Windows.Forms.Keys]::Right
            )) {
                return $true
            }
            return $false
        }
        if ($key -eq [System.Windows.Forms.Keys]::Left) {
            $state.selected = 'reject'
            $rejectButton.Focus()
            $hint.Text = "$($rejectButton.Text) (Enter)"
            return $true
        }
        if ($key -eq [System.Windows.Forms.Keys]::Right) {
            $state.selected = 'allow'
            $allowButton.Focus()
            $hint.Text = "$($allowButton.Text) (Enter)"
            return $true
        }
        if ($key -eq [System.Windows.Forms.Keys]::Enter) {
            if ($state.selected -eq 'allow') {
                $allowButton.PerformClick()
            }
            else {
                $rejectButton.PerformClick()
            }
            return $true
        }
        return $false
    }

    function Force-Foreground {
        try {
            $foreground = [DshApprovalNative]::GetForegroundWindow()
            [uint32]$foregroundPid = 0
            $foregroundThread = [DshApprovalNative]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
            $currentThread = [DshApprovalNative]::GetCurrentThreadId()
            if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
                [void][DshApprovalNative]::AttachThreadInput($currentThread, $foregroundThread, $true)
            }
            [void][DshApprovalNative]::SetWindowPos($form.Handle, [IntPtr]::new(-1), 0, 0, 0, 0, 0x43)
            [void][DshApprovalNative]::BringWindowToTop($form.Handle)
            [void][DshApprovalNative]::SetForegroundWindow($form.Handle)
            [void][DshApprovalNative]::SetActiveWindow($form.Handle)
            [void][DshApprovalNative]::SetFocus($form.Handle)
            if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
                [void][DshApprovalNative]::AttachThreadInput($currentThread, $foregroundThread, $false)
            }
            try { [void][Microsoft.VisualBasic.Interaction]::AppActivate($PID) } catch { }
            $form.Activate()
            $form.BringToFront()
            if (-not $allowButton.ContainsFocus -and -not $rejectButton.ContainsFocus) {
                $rejectButton.Focus()
            }
        }
        catch { }
    }

    $topState = @{ ticks = 0 }
    $topmostTimer = New-Object System.Windows.Forms.Timer
    $topmostTimer.Interval = 200
    $topmostTimer.Add_Tick({
        $topState.ticks++
        $form.TopMost = $true
        if (-not $form.ContainsFocus) {
            Force-Foreground
        }
        if ($topState.ticks -ge 25) {
            $topmostTimer.Stop()
        }
    })
    $form.Add_FormClosed({
        $topmostTimer.Stop()
        $topmostTimer.Dispose()
    })

    $form.Controls.AddRange(@($badge, $title, $subtitle, $divider, $toolLabel, $toolPill, $reasonLabel, $reasonCard, $hint, $rejectButton, $allowButton))
    foreach ($control in $labels) { $form.Controls.Add($control) }
    foreach ($control in $values) { $form.Controls.Add($control) }

    $form.Add_Shown({
        [void][DshApprovalNative]::ShowWindow($form.Handle, 5)
        Force-Foreground
        $rejectButton.Focus()
        $topmostTimer.Start()
        [System.Media.SystemSounds]::Exclamation.Play()
    })

    $result = $form.ShowDialog()
    $form.Dispose()

    if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
        exit 6
    }
    exit 7
}
catch {
    [Console]::Error.WriteLine($_.InvocationInfo.PositionMessage)
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 3
}
