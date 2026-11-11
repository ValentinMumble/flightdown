local ____exports = {}
local name = "Text"
local options = {{"Text", STRING, "My Label"}, {"Color", COLOR, COLOR_THEME_SECONDARY1}, {"Size", 5, 0}, {"Shadow", BOOL, 0}}
local function create(zone, options)
    local widget = {zone = zone, options = options}
    return widget
end
local function update(widget, options)
    widget.options = options
end
local sizes = {
    0,
    BOLD,
    TINSIZE,
    SMLSIZE,
    MIDSIZE,
    DBLSIZE,
    XXLSIZE
}
local function draw(widget, x, y, w, h)
    local fontSize = sizes[widget.options.Size + 1]
    local fontColor = widget.options.Color
    if widget.options.Shadow ~= 0 then
        lcd.drawText(1, 1, widget.options.Text, fontSize + BLACK)
    end
    lcd.drawText(0, 0, widget.options.Text, fontSize + fontColor)
end
local function refresh(widget, event, touch)
    if event ~= nil then
        draw(
            widget,
            0,
            0,
            LCD_W,
            LCD_H
        )
    else
        draw(
            widget,
            widget.zone.x,
            widget.zone.y,
            widget.zone.w,
            widget.zone.h
        )
    end
end
____exports.refresh = refresh
____exports.name = name
____exports.create = create
____exports.update = update
____exports.options = options
return ____exports
