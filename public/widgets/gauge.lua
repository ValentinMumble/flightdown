local ____exports = {}
local name = "Gauge"
local options = {{"Source", SOURCE, 1}, {
    "Min",
    VALUE,
    -FULLSCALE,
    -FULLSCALE,
    FULLSCALE
}, {
    "Max",
    VALUE,
    FULLSCALE,
    -FULLSCALE,
    FULLSCALE
}, {"Color", COLOR, COLOR_THEME_WARNING}}
local function update(widget, options)
    widget.options = options
end
local function create(zone, options)
    local widget = {zone = zone, options = options}
    update(widget, options)
    return widget
end
local function divRoundClosest(n, d)
    if d == 0 then
        return 0
    else
        return n < 0 ~= (d < 0) and math.ceil((n - d / 2) / d) or math.floor((n + d / 2) / d)
    end
end
local function clamp(num, min, max)
    return math.min(
        math.max(num, min),
        max
    )
end
local function draw(widget, x, y, width, height)
    local index = widget.options.Source
    local min = widget.options.Min
    local max = widget.options.Max
    local color = widget.options.Color
    local value = getValue(index)
    if min > max then
        local m = min
        min = max
        max = m
        value = value - min - max
    end
    value = clamp(min, value, max)
    local w = divRoundClosest(width * (value - min), max - min)
    local percent = divRoundClosest(100 * (value - min), max - min)
    lcd.drawSource(
        0,
        0,
        index,
        bit32.bor(SMLSIZE, COLOR_THEME_PRIMARY2)
    )
    lcd.setColor(CUSTOM_COLOR, color)
    lcd.drawFilledRectangle(
        0,
        16,
        width,
        16,
        COLOR_THEME_PRIMARY2
    )
    lcd.drawText(
        0 + width / 2,
        14,
        tostring(percent) .. "%",
        bit32.bor(
            bit32.bor(SMLSIZE, CUSTOM_COLOR),
            CENTER
        )
    )
    lcd.invertRect(
        w,
        16,
        width - w,
        16,
        CUSTOM_COLOR
    )
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
