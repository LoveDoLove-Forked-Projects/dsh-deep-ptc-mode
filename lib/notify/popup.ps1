# Deep PTC desktop notice: one small window at the bottom right of the screen, answered in place.
# It shows one question at a time; several cards and several questions are pages of the same window.
# ASCII only: Windows PowerShell 5.1 reads a script without BOM in the system code page. Every text the
# user sees arrives as JSON from lib/notify.mjs.
#
# stdin:  one JSON object per line
#   {"op":"show","id","kicker","title","subtitle","tone","blocks","note","fields","buttons","labels","app"}
#   {"op":"close","id"}  {"op":"error","id","text"}  {"op":"sound","path"}  {"op":"exit"}
# stdout: one JSON object per line
#   {"event":"ready"}  {"event":"submit","id","button","values"}  {"event":"hide","id"}  {"event":"open","id"}
# The notices never take the keyboard focus when they appear.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
$utf8 = New-Object System.Text.UTF8Encoding $false
$reader = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), $utf8
$writer = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $utf8
$writer.AutoFlush = $true
function Send($message) { $writer.WriteLine((ConvertTo-Json $message -Compress -Depth 8)) }

# ---- Look ------------------------------------------------------------------------------------
$dark = $true
try { $dark = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize').AppsUseLightTheme -eq 0 } catch { }
if ($dark) {
  $C = @{ card='#FF1E1F24'; line='#2BFFFFFF'; text='#FFF2F3F5'; muted='#FF9DA1AB'; soft='#12FFFFFF'; hover='#1EFFFFFF'; accent='#FF5B7BFF'; accentSoft='#2E5B7BFF'; accentText='#FFB9C6FF'; danger='#FFFF6B6B'; warn='#FFF2B84B'; good='#FF4CC38A'; field='#14FFFFFF' }
} else {
  $C = @{ card='#FFFFFFFF'; line='#1A000000'; text='#FF1B1D22'; muted='#FF6B7080'; soft='#08000000'; hover='#10000000'; accent='#FF4D6BFE'; accentSoft='#164D6BFE'; accentText='#FF2F48C9'; danger='#FFD93B3B'; warn='#FFB7791F'; good='#FF1F9D63'; field='#06000000' }
}
$converter = New-Object System.Windows.Media.BrushConverter
$brushes = @{}
function Brush([string]$name) {
  if (-not $brushes.ContainsKey($name)) { $b = $converter.ConvertFromString($C[$name]); $b.Freeze(); $brushes[$name] = $b }
  $brushes[$name]
}
function ToneBrush([string]$tone) {
  switch ($tone) { 'success' { Brush 'good' } 'warn' { Brush 'warn' } 'danger' { Brush 'danger' } default { Brush 'accent' } }
}
$fontName = 'Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, Microsoft YaHei'
$styles = [Windows.Markup.XamlReader]::Parse(@"
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Style x:Key="Button" TargetType="Button">
    <Setter Property="Foreground" Value="$($C.text)"/><Setter Property="Background" Value="$($C.soft)"/><Setter Property="Cursor" Value="Hand"/>
    <Setter Property="FontSize" Value="12"/><Setter Property="Padding" Value="12,5"/><Setter Property="FocusVisualStyle" Value="{x:Null}"/>
    <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
      <Grid>
        <Border CornerRadius="9" Background="{TemplateBinding Background}"/>
        <Border x:Name="over" CornerRadius="9" Background="$($C.hover)" BorderThickness="1" BorderBrush="Transparent" Opacity="0"/>
        <ContentPresenter Margin="{TemplateBinding Padding}" HorizontalAlignment="Center" VerticalAlignment="Center"/>
      </Grid>
      <ControlTemplate.Triggers>
        <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="over" Property="Opacity" Value="1"/></Trigger>
        <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="over" Property="Opacity" Value="1"/><Setter TargetName="over" Property="BorderBrush" Value="$($C.accent)"/></Trigger>
        <Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.45"/></Trigger>
      </ControlTemplate.Triggers>
    </ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style x:Key="Primary" TargetType="Button" BasedOn="{StaticResource Button}"><Setter Property="Background" Value="$($C.accent)"/><Setter Property="Foreground" Value="White"/><Setter Property="FontWeight" Value="SemiBold"/></Style>
  <Style x:Key="Danger" TargetType="Button" BasedOn="{StaticResource Button}"><Setter Property="Foreground" Value="$($C.danger)"/></Style>
  <Style x:Key="Quiet" TargetType="Button" BasedOn="{StaticResource Button}"><Setter Property="Background" Value="Transparent"/><Setter Property="Foreground" Value="$($C.muted)"/><Setter Property="Padding" Value="6,4"/><Setter Property="FontSize" Value="11.5"/></Style>
  <Style x:Key="Option" TargetType="ToggleButton">
    <Setter Property="Foreground" Value="$($C.text)"/><Setter Property="Cursor" Value="Hand"/><Setter Property="FontSize" Value="13"/><Setter Property="FocusVisualStyle" Value="{x:Null}"/>
    <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ToggleButton">
      <Border x:Name="box" CornerRadius="8" Background="$($C.soft)" BorderBrush="Transparent" BorderThickness="1" Padding="9,5">
        <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <Border x:Name="ring" Width="14" Height="14" CornerRadius="{TemplateBinding Tag}" BorderThickness="1.3" BorderBrush="$($C.muted)" VerticalAlignment="Top" Margin="0,2,8,0">
            <Path x:Name="mark" Data="M2.4,5.6 L4.7,7.9 L8.8,3.1" Stroke="White" StrokeThickness="1.7" StrokeStartLineCap="Round" StrokeEndLineCap="Round" StrokeLineJoin="Round" Opacity="0"/>
          </Border>
          <ContentPresenter Grid.Column="1"/>
        </Grid>
      </Border>
      <ControlTemplate.Triggers>
        <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="box" Property="Background" Value="$($C.hover)"/></Trigger>
        <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="box" Property="BorderBrush" Value="$($C.accent)"/></Trigger>
        <Trigger Property="IsChecked" Value="True">
          <Setter TargetName="box" Property="Background" Value="$($C.accentSoft)"/><Setter TargetName="box" Property="BorderBrush" Value="$($C.accent)"/>
          <Setter TargetName="ring" Property="Background" Value="$($C.accent)"/><Setter TargetName="ring" Property="BorderBrush" Value="$($C.accent)"/><Setter TargetName="mark" Property="Opacity" Value="1"/>
        </Trigger>
        <Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.5"/></Trigger>
      </ControlTemplate.Triggers>
    </ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style x:Key="Input" TargetType="TextBox">
    <Setter Property="Foreground" Value="$($C.text)"/><Setter Property="CaretBrush" Value="$($C.text)"/><Setter Property="FontSize" Value="13"/>
    <Setter Property="SelectionBrush" Value="$($C.accent)"/><Setter Property="FocusVisualStyle" Value="{x:Null}"/>
    <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="TextBox">
      <Border x:Name="box" CornerRadius="9" Background="$($C.field)" BorderBrush="$($C.line)" BorderThickness="1" Padding="7,5">
        <Grid><TextBlock x:Name="hint" Text="{TemplateBinding Tag}" Foreground="$($C.muted)" Margin="2,0,0,0" IsHitTestVisible="False" Visibility="Collapsed" TextTrimming="CharacterEllipsis"/><ScrollViewer x:Name="PART_ContentHost"/></Grid>
      </Border>
      <ControlTemplate.Triggers>
        <Trigger Property="Text" Value=""><Setter TargetName="hint" Property="Visibility" Value="Visible"/></Trigger>
        <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="box" Property="BorderBrush" Value="$($C.accent)"/></Trigger>
      </ControlTemplate.Triggers>
    </ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style TargetType="ScrollBar">
    <Setter Property="Width" Value="6"/><Setter Property="MinWidth" Value="6"/><Setter Property="Background" Value="Transparent"/>
    <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ScrollBar">
      <Track x:Name="PART_Track" IsDirectionReversed="True"><Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType="Thumb"><Border CornerRadius="3" Background="$($C.line)"/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb></Track>
    </ControlTemplate></Setter.Value></Setter>
  </Style>
</ResourceDictionary>
"@)

function Text([string]$value, [double]$size = 13, [string]$color = 'text', [string]$weight = 'Normal') {
  $t = New-Object System.Windows.Controls.TextBlock
  $t.Text = $value; $t.FontSize = $size; $t.Foreground = Brush $color; $t.FontWeight = $weight; $t.TextWrapping = 'Wrap'
  $t
}
function Gap($element, [double]$top) { $element.Margin = New-Object System.Windows.Thickness 0, $top, 0, 0; $element }
function Columns($grid, [string[]]$widths) {
  foreach ($w in $widths) {
    $c = New-Object System.Windows.Controls.ColumnDefinition
    if ($w -eq 'auto') { $c.Width = [System.Windows.GridLength]::Auto } else { $c.Width = New-Object System.Windows.GridLength ([double]$w), 'Star' }
    $grid.ColumnDefinitions.Add($c)
  }
}
function Place($grid, $element, [int]$row, [int]$column) {
  [System.Windows.Controls.Grid]::SetRow($element, $row); [System.Windows.Controls.Grid]::SetColumn($element, $column); [void]$grid.Children.Add($element)
}

# ---- Card blocks -----------------------------------------------------------------------------
function Meter([string]$label, [string]$value, [double]$share, $brush) {
  $stack = New-Object System.Windows.Controls.StackPanel
  $head = New-Object System.Windows.Controls.Grid; Columns $head @('1', 'auto')
  Place $head (Text $label 12 'muted') 0 0; Place $head (Text $value 12 'text' 'SemiBold') 0 1
  [void]$stack.Children.Add($head)
  $bar = New-Object System.Windows.Controls.Grid; $bar.Height = 5
  $share = [Math]::Max(0.0, [Math]::Min(1.0, $share))
  Columns $bar @([string]([Math]::Max($share, 0.0001)).ToString([Globalization.CultureInfo]::InvariantCulture), [string]([Math]::Max(1 - $share, 0.0001)).ToString([Globalization.CultureInfo]::InvariantCulture))
  $track = New-Object System.Windows.Controls.Border; $track.CornerRadius = 2.5; $track.Background = Brush 'soft'; [System.Windows.Controls.Grid]::SetColumnSpan($track, 2)
  Place $bar $track 0 0
  $fill = New-Object System.Windows.Controls.Border; $fill.CornerRadius = 2.5; $fill.Background = $brush
  Place $bar $fill 0 0
  [void]$stack.Children.Add((Gap $bar 4))
  $stack
}
function Block($block) {
  $stack = New-Object System.Windows.Controls.StackPanel
  if ($block.title) { [void]$stack.Children.Add((Text $block.title 12 'muted' 'SemiBold')) }
  switch ($block.type) {
    'stats' {
      $grid = New-Object System.Windows.Controls.Primitives.UniformGrid; $grid.Rows = 1
      foreach ($item in @($block.items)) {
        $cell = New-Object System.Windows.Controls.StackPanel
        [void]$cell.Children.Add((Text $item.label 12 'muted'))
        $value = Text $item.value 15 'text' 'SemiBold'; if ($item.tone -and $item.tone -ne 'neutral') { $value.Foreground = ToneBrush $item.tone }
        [void]$cell.Children.Add($value)
        if ($item.delta -or $item.hint) { [void]$cell.Children.Add((Text ((@($item.delta, $item.hint) | Where-Object { $_ }) -join '  ') 11 'muted')) }
        [void]$grid.Children.Add($cell)
      }
      [void]$stack.Children.Add($grid)
    }
    'rows' {
      foreach ($item in @($block.items)) {
        $grid = New-Object System.Windows.Controls.Grid; Columns $grid @('1', '1.6')
        Place $grid (Text $item.label 12.5 'muted') 0 0; Place $grid (Text ([string]$item.value) 12.5) 0 1
        [void]$stack.Children.Add((Gap $grid 3))
      }
    }
    'meters' { foreach ($item in @($block.items)) { [void]$stack.Children.Add((Gap (Meter $item.label $item.value ([double]$item.share) (ToneBrush $item.tone)) 5)) } }
    'steps' {
      foreach ($item in @($block.items)) {
        $grid = New-Object System.Windows.Controls.Grid; Columns $grid @('auto', '1')
        $mark = switch ($item.state) { 'done' { [char]0x2713 } 'active' { [char]0x25B8 } 'failed' { [char]0x2715 } default { [char]0x25CB } }
        $sign = Text ([string]$mark) 12.5 'muted'; $sign.Width = 20
        if ($item.state -eq 'done') { $sign.Foreground = Brush 'good' } elseif ($item.state -eq 'failed') { $sign.Foreground = Brush 'danger' } elseif ($item.state -eq 'active') { $sign.Foreground = Brush 'accent' }
        $label = $item.label; if ($item.value) { $label = $label + '  ' + $item.value }
        Place $grid $sign 0 0; Place $grid (Text $label 12.5) 0 1
        [void]$stack.Children.Add((Gap $grid 3))
      }
    }
    'table' {
      $grid = New-Object System.Windows.Controls.Grid
      Columns $grid @($block.columns | ForEach-Object { '1' })
      $r = 0
      foreach ($row in (@(, @($block.columns)) + @($block.rows | ForEach-Object { , @($_) }))) {
        $grid.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition))
        for ($i = 0; $i -lt @($row).Count; $i++) {
          $cell = if ($r -eq 0) { Text ([string]@($row)[$i]) 11.5 'muted' 'SemiBold' } else { Text ([string]@($row)[$i]) 12.5 }
          $cell.Margin = New-Object System.Windows.Thickness 0, 3, 8, 0
          Place $grid $cell $r $i
        }
        $r++
      }
      [void]$stack.Children.Add($grid)
    }
    'tags' {
      $wrap = New-Object System.Windows.Controls.WrapPanel
      foreach ($item in @($block.items)) {
        $chip = New-Object System.Windows.Controls.Border; $chip.CornerRadius = 8; $chip.Background = Brush 'soft'; $chip.Padding = '8,2'; $chip.Margin = '0,3,6,0'; $chip.Child = Text $item.label 12
        [void]$wrap.Children.Add($chip)
      }
      [void]$stack.Children.Add($wrap)
    }
    'callout' {
      $box = New-Object System.Windows.Controls.Border; $box.CornerRadius = 8; $box.Background = Brush 'soft'; $box.Padding = '10,7'
      $box.BorderThickness = '3,0,0,0'; $box.BorderBrush = ToneBrush $block.tone; $box.Child = Text $block.text 12.5
      [void]$stack.Children.Add($box)
    }
    default { if ($block.text) { [void]$stack.Children.Add((Text $block.text 12.5)) } }
  }
  $stack
}

# ---- Fields ----------------------------------------------------------------------------------
# Each field keeps its controls in a hashtable; ReadField turns them into a value.
# One choice of a single-choice field is always on; Checked and Unchecked cover mouse, keyboard and
# assistive tools alike.
function OnChecked($button) {
  $state = $button.DataContext
  if ($state.type -ne 'multi') {
    $state.last = $button
    foreach ($other in $state.options) { if ($other -ne $button) { $other.IsChecked = $false } }
  }
  if ($state.own -and $button -eq $state.ownButton) { $state.own.Visibility = 'Visible'; if ($state.own.IsLoaded) { [void]$state.own.Focus() } }
}
function OnUnchecked($button) {
  $state = $button.DataContext
  if ($state.type -ne 'multi' -and $state.last -eq $button) { $button.IsChecked = $true; return }
  if ($state.own -and $button -eq $state.ownButton) { $state.own.Visibility = 'Collapsed' }
}
function NewOption($state, [string]$label, [string]$hint, $value, [bool]$on) {
  $button = New-Object System.Windows.Controls.Primitives.ToggleButton
  $button.Style = $styles['Option']
  $button.Tag = New-Object System.Windows.CornerRadius $(if ($state.type -eq 'multi') { 4 } else { 8 })
  $content = New-Object System.Windows.Controls.StackPanel
  [void]$content.Children.Add((Text $label 12.5))
  if ($hint) {
    # One line; the whole hint is in the tooltip.
    $small = Text $hint 11 'muted'; $small.TextWrapping = 'NoWrap'; $small.TextTrimming = 'CharacterEllipsis'; $small.ToolTip = $hint
    [void]$content.Children.Add($small)
  }
  $button.Content = $content; $button.Margin = '0,4,0,0'; $button.DataContext = $state
  [System.Windows.Automation.AutomationProperties]::SetName($button, $label)
  $button.Resources['value'] = $value
  [void]$state.options.Add($button)
  if ($on) { $button.IsChecked = $true; $state.last = $button }
  $button.Add_Checked({ OnChecked $this }); $button.Add_Unchecked({ OnUnchecked $this })
  $button
}
function NewInput([string]$value, [string]$hint, [bool]$lines) {
  $box = New-Object System.Windows.Controls.TextBox
  $box.Style = $styles['Input']; $box.Text = $value; $box.Tag = $hint; $box.Margin = '0,4,0,0'; $box.FontSize = 12.5; $box.MaxLength = 1000
  if ($lines) { $box.AcceptsReturn = $true; $box.TextWrapping = 'Wrap'; $box.MinLines = 1; $box.MaxLines = 4; $box.VerticalScrollBarVisibility = 'Auto' }
  $box
}
function Field($field, $labels, $panel) {
  $state = @{ id = $field.id; type = $field.type; options = New-Object System.Collections.ArrayList; own = $null; ownButton = $null; box = $null; last = $null }
  if ($field.prompt) {
    $prompt = $field.prompt; if ($field.optional) { $prompt = $prompt + '  (' + $labels.optional + ')' }
    [void]$panel.Children.Add((Gap (Text $prompt 12.5 'text' 'SemiBold') 6))
  }
  if ($field.type -eq 'single' -or $field.type -eq 'multi') {
    $chosen = @($field.value)
    foreach ($option in @($field.options)) { [void]$panel.Children.Add((NewOption $state $option.label ([string]$option.hint) $option.value ($chosen -ccontains $option.value))) }
    if ($field.custom) {
      $state.ownButton = NewOption $state $labels.other '' $null $false
      [void]$panel.Children.Add($state.ownButton)
      $state.own = NewInput '' $labels.otherHint $true
      $state.own.Visibility = 'Collapsed'
      [void]$panel.Children.Add($state.own)
    }
  } else {
    $hint = [string]$field.placeholder; if (-not $hint) { $hint = [string]$labels[[string]$field.type] }
    $state.box = NewInput ([string]$field.value) $hint ($field.type -eq 'text')
    [System.Windows.Automation.AutomationProperties]::SetName($state.box, [string]$field.prompt)
    [void]$panel.Children.Add($state.box)
  }
  $state
}
function ReadField($state) {
  if ($state.box) { return $state.box.Text.Trim() }
  $picked = @($state.options | Where-Object { $_.IsChecked -and $_ -ne $state.ownButton } | ForEach-Object { $_.Resources['value'] })
  if ($state.ownButton -and $state.ownButton.IsChecked -and $state.own.Text.Trim()) {
    $words = @($state.options | Where-Object { $_.IsChecked -and $_ -ne $state.ownButton } | ForEach-Object { $_.Content.Children[0].Text }) + @($state.own.Text.Trim())
    return @{ custom = ($words -join ', ') }
  }
  if ($state.type -eq 'multi') { return , $picked }
  if ($picked.Count -gt 0) { return $picked[0] }
  return ''
}

# ---- The window ------------------------------------------------------------------------------
# $open holds the cards in the order they arrived; every card has one page per question. $at is the
# page on screen: the card's id and the question's index.
$open = New-Object System.Collections.Specialized.OrderedDictionary
$at = @{ id = $null; step = 0 }
$ui = $null
$WIDTH = 332
function Animate($target, $property, [double]$from, [double]$to, [int]$ms) {
  $a = New-Object System.Windows.Media.Animation.DoubleAnimation $from, $to, (New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds($ms)))
  $ease = New-Object System.Windows.Media.Animation.CubicEase; $ease.EasingMode = 'EaseOut'; $a.EasingFunction = $ease
  $target.BeginAnimation($property, $a)
}
function Corner {
  $area = [System.Windows.SystemParameters]::WorkArea
  $ui.window.Left = $area.Right - $ui.window.ActualWidth - 2
  $ui.window.Top = [Math]::Max($area.Top, $area.Bottom - $ui.window.ActualHeight - 2)
}
function QuietButton($content, [string]$name, $click) {
  $b = New-Object System.Windows.Controls.Button; $b.Style = $styles['Quiet']; $b.Content = $content; $b.VerticalAlignment = 'Center'
  if ($name) { $b.ToolTip = $name; [System.Windows.Automation.AutomationProperties]::SetName($b, $name) }
  $b.Add_Click($click); $b
}
function Pages {
  $list = New-Object System.Collections.ArrayList
  foreach ($entry in @($open.Values)) { for ($i = 0; $i -lt $entry.pages.Count; $i++) { [void]$list.Add(@{ id = $entry.id; step = $i }) } }
  , $list
}
function Turn([int]$by) {
  $pages = Pages
  for ($i = 0; $i -lt $pages.Count; $i++) {
    if ($pages[$i].id -eq $at.id -and $pages[$i].step -eq $at.step) {
      $next = $i + $by
      if ($next -ge 0 -and $next -lt $pages.Count) { $at.id = $pages[$next].id; $at.step = $pages[$next].step; Render $by }
      return
    }
  }
}
function BuildWindow($labels) {
  $window = New-Object System.Windows.Window
  $window.WindowStyle = 'None'; $window.AllowsTransparency = $true; $window.Background = [System.Windows.Media.Brushes]::Transparent
  $window.ResizeMode = 'NoResize'; $window.ShowInTaskbar = $false; $window.Topmost = $true; $window.ShowActivated = $false
  $window.SizeToContent = 'Height'; $window.Width = $WIDTH; $window.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
  $window.UseLayoutRounding = $true; $window.SnapsToDevicePixels = $true; $window.Title = 'Deep PTC'
  foreach ($key in @($styles.Keys)) { $window.Resources[$key] = $styles[$key] }
  $area = [System.Windows.SystemParameters]::WorkArea
  $window.Left = $area.Right - $WIDTH - 2; $window.Top = $area.Bottom
  $layers = New-Object System.Windows.Controls.Grid; $window.Content = $layers
  # The shadow sits on a sibling so text stays crisp.
  $back = New-Object System.Windows.Controls.Border; $back.CornerRadius = 14; $back.Background = Brush 'card'; $back.Margin = 12
  $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect; $shadow.BlurRadius = 18; $shadow.ShadowDepth = 3; $shadow.Direction = 270; $shadow.Opacity = 0.26
  $back.Effect = $shadow; [void]$layers.Children.Add($back)
  $shell = New-Object System.Windows.Controls.Border; $shell.CornerRadius = 14; $shell.Background = Brush 'card'; $shell.BorderBrush = Brush 'line'; $shell.BorderThickness = 1; $shell.Margin = 12
  [void]$layers.Children.Add($shell)
  $page = New-Object System.Windows.Controls.StackPanel; $page.Margin = '14,9,14,11'; $shell.Child = $page
  $head = New-Object System.Windows.Controls.Grid; Columns $head @('auto', '1', 'auto', 'auto', 'auto', 'auto')
  $dot = New-Object System.Windows.Shapes.Ellipse; $dot.Width = 7; $dot.Height = 7; $dot.VerticalAlignment = 'Center'; $dot.Margin = '0,0,7,0'
  $kicker = Text '' 11.5 'muted'; $kicker.VerticalAlignment = 'Center'; $kicker.TextWrapping = 'NoWrap'; $kicker.TextTrimming = 'CharacterEllipsis'
  $prev = QuietButton ([string][char]0x2039) $labels.previous { Turn -1 }
  $count = Text '' 11.5 'muted'; $count.VerticalAlignment = 'Center'; $count.Margin = '1,0,1,0'
  $next = QuietButton ([string][char]0x203A) $labels.next { Turn 1 }
  $close = QuietButton ([string][char]0x2715) $labels.hide { $n = [string]$at.id; Drop $n; Send @{ event = 'hide'; id = $n } }
  $close.FontSize = 10; $close.Margin = '2,0,-6,0'
  Place $head $dot 0 0; Place $head $kicker 0 1; Place $head $prev 0 2; Place $head $count 0 3; Place $head $next 0 4; Place $head $close 0 5
  [void]$page.Children.Add($head)
  $title = Text '' 13.5 'text' 'SemiBold'; [void]$page.Children.Add((Gap $title 1))
  $title.MaxHeight = 56; $title.TextTrimming = 'CharacterEllipsis'
  $subtitle = Text '' 11.5 'muted'; $subtitle.MaxHeight = 32; $subtitle.TextTrimming = 'CharacterEllipsis'; [void]$page.Children.Add((Gap $subtitle 2))
  $scroll = New-Object System.Windows.Controls.ScrollViewer
  $scroll.VerticalScrollBarVisibility = 'Auto'; $scroll.MaxHeight = [Math]::Max(120, [Math]::Min(232, $area.Height - 220)); $scroll.Margin = '0,2,-6,0'
  [void]$page.Children.Add($scroll)
  $note = Text '' 11 'muted'; $note.MaxHeight = 30; $note.TextTrimming = 'CharacterEllipsis'; [void]$page.Children.Add((Gap $note 6))
  $errorText = Text '' 11.5 'danger'; [void]$page.Children.Add((Gap $errorText 5))
  $foot = New-Object System.Windows.Controls.Grid; Columns $foot @('auto', '1')
  $go = QuietButton $labels.open '' { Send @{ event = 'open'; id = [string]$at.id } }; $go.Margin = '-6,0,0,0'
  Place $foot $go 0 0
  $actions = New-Object System.Windows.Controls.WrapPanel; $actions.HorizontalAlignment = 'Right'; Place $foot $actions 0 1
  [void]$page.Children.Add((Gap $foot 8))
  $window.Add_SizeChanged({ Corner })
  $window.Add_PreviewKeyDown({
    if ($_.Key -eq 'Escape') { $n = [string]$at.id; Drop $n; Send @{ event = 'hide'; id = $n }; $_.Handled = $true }
    elseif ($_.OriginalSource -isnot [System.Windows.Controls.TextBox]) {
      if ($_.Key -eq 'Left') { Turn -1; $_.Handled = $true } elseif ($_.Key -eq 'Right') { Turn 1; $_.Handled = $true }
    }
  })
  # Alt+F4 hides the notice; the cards stay in DSH.
  $window.Add_Closing({ if (-not $ui.ending) { $_.Cancel = $true; foreach ($n in @($open.Keys)) { Drop $n; Send @{ event = 'hide'; id = $n } } } })
  $script:ui = @{ window = $window; layers = $layers; dot = $dot; kicker = $kicker; prev = $prev; count = $count; next = $next; title = $title; subtitle = $subtitle
    scroll = $scroll; note = $note; error = $errorText; actions = $actions; go = $go; foot = $foot; labels = $labels; visible = $false; ending = $false }
}
function ShowText($element, [string]$value) { $element.Text = $value; $element.ToolTip = $(if ($value.Length -gt 60) { $value } else { $null }); $element.Visibility = $(if ($value) { 'Visible' } else { 'Collapsed' }) }
function ActionButton([string]$label, [string]$style, $click, $tag) {
  $b = New-Object System.Windows.Controls.Button
  $b.Style = switch ($style) { 'primary' { $styles['Primary'] } 'danger' { $styles['Danger'] } default { $styles['Button'] } }
  $b.Content = $label; $b.Margin = '6,0,0,4'; $b.Tag = $tag; $b.Add_Click($click)
  [void]$ui.actions.Children.Add($b)
}
function Render([int]$direction = 0) {
  $entry = $open[[string]$at.id]
  $pages = Pages
  $index = 0
  for ($i = 0; $i -lt $pages.Count; $i++) { if ($pages[$i].id -eq $at.id -and $pages[$i].step -eq $at.step) { $index = $i } }
  $ui.dot.Fill = ToneBrush ([string]$entry.data.tone)
  $ui.kicker.Text = [string]$entry.data.kicker
  $many = $pages.Count -gt 1
  foreach ($part in @($ui.prev, $ui.count, $ui.next)) { $part.Visibility = $(if ($many) { 'Visible' } else { 'Collapsed' }) }
  $ui.count.Text = [string]($index + 1) + '/' + $pages.Count
  $ui.prev.IsEnabled = $index -gt 0; $ui.next.IsEnabled = $index -lt $pages.Count - 1
  ShowText $ui.title ([string]$entry.data.title)
  ShowText $ui.subtitle ([string]$entry.data.subtitle)
  $ui.scroll.Content = $entry.pages[$at.step]; $ui.scroll.ScrollToTop()
  $ui.scroll.Visibility = $(if ($entry.pages[$at.step].Children.Count -gt 0) { 'Visible' } else { 'Collapsed' })
  ShowText $ui.note ([string]$entry.data.note)
  ShowText $ui.error ([string]$entry.error)
  $ui.actions.Children.Clear()
  if ($at.step -lt $entry.pages.Count - 1) { ActionButton $ui.labels.nextQuestion 'primary' { Turn 1 } $null }
  else { foreach ($button in @($entry.data.buttons)) { if ($button) { ActionButton ([string]$button.label) ([string]$button.style) { Submit ([string]$this.Tag) } ([string]$button.id) } } }
  $ui.scroll.IsEnabled = -not $entry.busy; $ui.actions.IsEnabled = -not $entry.busy
  if ($direction -ne 0) {
    $move = New-Object System.Windows.Media.TranslateTransform; $ui.scroll.RenderTransform = $move
    Animate $move ([System.Windows.Media.TranslateTransform]::XProperty) (14 * $direction) 0 160
    Animate $ui.scroll ([System.Windows.UIElement]::OpacityProperty) 0.2 1 160
  }
}
function Submit([string]$button) {
  $entry = $open[[string]$at.id]
  $values = @{}
  foreach ($state in $entry.fields) { $values[$state.id] = ReadField $state }
  $entry.error = ''; $entry.busy = $true
  Render
  Send @{ event = 'submit'; id = $entry.id; button = $button; values = $values }
}
# Take a card out; the window moves on to the next one, or hides after the last.
function Drop([string]$id) {
  if (-not $open.Contains($id)) { return }
  $ids = @($open.Keys); $place = [Array]::IndexOf($ids, $id)
  $open.Remove($id)
  if ($open.Count -eq 0) { $at.id = $null; $ui.visible = $false; $ui.window.Hide(); return }
  if ($at.id -eq $id) { $at.id = @($open.Keys)[[Math]::Min($place, $open.Count - 1)]; $at.step = 0; Render 1 } else { Render }
}
function ShowNotice($data) {
  $id = [string]$data.id
  if ($open.Contains($id)) { return }
  $labels = @{}; foreach ($p in $data.labels.PSObject.Properties) { $labels[$p.Name] = $p.Value }
  if ($null -eq $ui) { BuildWindow $labels }
  $entry = @{ id = $id; data = $data; pages = New-Object System.Collections.ArrayList; fields = New-Object System.Collections.ArrayList; error = ''; busy = $false }
  $page = New-Object System.Windows.Controls.StackPanel; $page.Margin = '0,0,8,0'
  foreach ($block in @($data.blocks)) { if ($block) { [void]$page.Children.Add((Gap (Block $block) 6)) } }
  $first = $true
  foreach ($field in @($data.fields)) {
    if (-not $field) { continue }
    # The card's content leads the first question; every further question has its own page.
    if (-not $first) { [void]$entry.pages.Add($page); $page = New-Object System.Windows.Controls.StackPanel; $page.Margin = '0,0,8,0' }
    $first = $false
    [void]$entry.fields.Add((Field $field $labels $page))
  }
  [void]$entry.pages.Add($page)
  $open[$id] = $entry
  if ($null -eq $at.id) { $at.id = $id; $at.step = 0 }
  Render
  if (-not $ui.visible) {
    $ui.visible = $true
    $slide = New-Object System.Windows.Media.TranslateTransform; $ui.layers.RenderTransform = $slide
    $ui.window.Show(); Corner
    Animate $ui.layers ([System.Windows.UIElement]::OpacityProperty) 0 1 180
    Animate $slide ([System.Windows.Media.TranslateTransform]::XProperty) 28 0 220
  }
}

# ---- Focus -----------------------------------------------------------------------------------
$native = $null
function ForegroundIs([string]$name) {
  try {
    if ($null -eq $script:native) {
      $script:native = Add-Type -PassThru -Namespace DeepPtc -Name Foreground -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint id);'
    }
    $processId = 0
    [void]$script:native::GetWindowThreadProcessId($script:native::GetForegroundWindow(), [ref]$processId)
    return (Get-Process -Id $processId).ProcessName -eq $name
  } catch { return $false }
}

# ---- Messages --------------------------------------------------------------------------------
# ---- Sound -----------------------------------------------------------------------------------
$script:sounds = New-Object System.Collections.ArrayList
function PlayAlert($message) {
  try {
    $volume = 0.7
    if ($null -ne $message.volume) { $volume = [double]$message.volume / 100.0 }
    $volume = [Math]::Max(0.0, [Math]::Min(1.0, $volume))
    $start = $null
    if ($null -ne $message.start) { $start = [double]$message.start }
    $end = $null
    if ($null -ne $message.end) { $end = [double]$message.end }
    $seconds = 1.2
    if ($null -ne $start -and $null -ne $end) { $seconds = $end - $start } elseif ($null -ne $end) { $seconds = $end }
    $alert = New-Object System.Windows.Media.MediaPlayer
    $alert.Volume = $volume
    $alert.add_MediaFailed({ param($sender, $args) [Console]::Error.WriteLine('sound failed: ' + $args.ErrorException.Message) })
    $alert.Open([Uri]([string]$message.path))
    [void]$script:sounds.Add([pscustomobject]@{ Player = $alert; Start = $start; Started = $false; Born = (Get-Date); StopAt = (Get-Date); Seconds = $seconds })
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
function TickSounds {
  $now = Get-Date
  for ($i = $script:sounds.Count - 1; $i -ge 0; $i--) {
    $entry = $script:sounds[$i]
    try {
      if (-not $entry.Started) {
        if ($entry.Player.NaturalDuration.HasTimeSpan) {
          if ($null -ne $entry.Start) { $entry.Player.Position = [TimeSpan]::FromSeconds([double]$entry.Start) }
          $entry.Player.Play()
          $entry.Started = $true
          $entry.StopAt = $now.AddSeconds([Math]::Max(0.3, [double]$entry.Seconds))
        } elseif (($now - $entry.Born).TotalSeconds -gt 3) {
          try { $entry.Player.Close() } catch { }
          $script:sounds.RemoveAt($i)
        }
        continue
      }
      if ($now -ge $entry.StopAt) {
        try { $entry.Player.Close() } catch { }
        $script:sounds.RemoveAt($i)
      }
    } catch {
      try { $entry.Player.Close() } catch { }
      $script:sounds.RemoveAt($i)
    }
  }
}
$script:soundTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:soundTimer.Interval = [TimeSpan]::FromMilliseconds(60)
$script:soundTimer.Add_Tick({ TickSounds })
$script:soundTimer.Start()
function Handle($message) {
  switch ($message.op) {
    'show' { if (-not ($message.unless -and (ForegroundIs ([string]$message.unless)))) { ShowNotice $message } else { Send @{ event = 'hide'; id = [string]$message.id } } }
    'close' { Drop ([string]$message.id) }
    'error' {
      if ($open.Contains([string]$message.id)) { $entry = $open[[string]$message.id]; $entry.error = [string]$message.text; $entry.busy = $false; if ($at.id -eq $entry.id) { Render } }
    }
    'sound' { PlayAlert $message }
    'exit' { if ($ui) { $ui.ending = $true }; [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() }
  }
}
$pending = $reader.ReadLineAsync()
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(40)
$timer.Add_Tick({
  while ($script:pending.IsCompleted) {
    $line = $script:pending.Result
    # The host closed the pipe: nothing can answer any more.
    if ($null -eq $line) { $timer.Stop(); [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown(); return }
    $script:pending = $reader.ReadLineAsync()
    if ($line.Trim()) { try { Handle (ConvertFrom-Json $line) } catch { [Console]::Error.WriteLine($_.Exception.Message + ' @ ' + $_.InvocationInfo.ScriptLineNumber) } }
  }
})
$timer.Start()
Send @{ event = 'ready' }
[System.Windows.Threading.Dispatcher]::Run()
