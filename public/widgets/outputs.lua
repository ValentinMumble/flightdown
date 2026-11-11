-- Lua Library inline imports
local function __TS__StringPadStart(self, maxLength, fillString)
    if fillString == nil then
        fillString = " "
    end
    if maxLength ~= maxLength then
        maxLength = 0
    end
    if maxLength == -math.huge or maxLength == math.huge then
        error("Invalid string length", 0)
    end
    if #self >= maxLength or #fillString == 0 then
        return self
    end
    maxLength = maxLength - #self
    if maxLength > #fillString then
        fillString = fillString .. string.rep(
            fillString,
            math.floor(maxLength / #fillString)
        )
    end
    return string.sub(
        fillString,
        1,
        math.floor(maxLength)
    ) .. self
end
-- End of Lua Library inline imports
local ____exports = {}
local name = "Outputs"
local ROW_HEIGHT = 17
local RECT_BORDER = 1
local options = {
    {"FirstChannel", VALUE, 1},
    {
        "Transparency",
        VALUE,
        2,
        0,
        5
    },
    {"BgColor", COLOR, COLOR_THEME_SECONDARY3},
    {
        "TextColor",
        COLOR,
        bit32.arshift(COLOR_THEME_PRIMARY1, 16)
    },
    {
        "BarColor",
        COLOR,
        bit32.arshift(COLOR_THEME_SECONDARY1, 16)
    }
}
local function update(widget, options)
    widget.options = options
end
local function create(zone, options)
    local modelInfo = model.getInfo()
    local widget = {zone = zone, options = options, limitPct = modelInfo.extendedLimits and LIMIT_EXT_PERCENT or LIMIT_STD_PERCENT}
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
local function drawChannels(widget, x, y, w, h, firstChan)
    local numChan = h / ROW_HEIGHT
    local lastChan = firstChan + numChan
    local rowH = h - numChan * ROW_HEIGHT >= numChan and ROW_HEIGHT + 1 or ROW_HEIGHT
    local barW = w - RECT_BORDER * 2
    local barH = rowH - RECT_BORDER
    local barLft = x + RECT_BORDER
    local barMid = barLft + barW / 2
    local barColor = widget.options.BarColor
    local txtColor = widget.options.TextColor
    do
        local curChan = firstChan
        while curChan < lastChan and curChan <= MAX_OUTPUT_CHANNELS do
            local chanVal = divRoundClosest(
                getOutputValue(curChan - 1) * 100,
                FULLSCALE
            )
            local rowTop = y + (curChan - firstChan) * rowH
            local barTop = rowTop + RECT_BORDER
            local fillW = divRoundClosest(
                barW * clamp(
                    0,
                    math.abs(chanVal),
                    widget.limitPct
                ),
                widget.limitPct * 2
            )
            if widget.options.Transparency > 0 then
                lcd.setColor(CUSTOM_COLOR, widget.options.BgColor)
                lcd.drawFilledRectangle(
                    barLft,
                    barTop,
                    barW,
                    barH,
                    CUSTOM_COLOR,
                    widget.options.Transparency
                )
            end
            if fillW ~= 0 then
                lcd.setColor(CUSTOM_COLOR, barColor)
                lcd.drawFilledRectangle(
                    chanVal > 0 and barMid or barMid - fillW,
                    barTop,
                    fillW,
                    barH,
                    CUSTOM_COLOR
                )
            end
            lcd.drawLine(
                barMid,
                barTop,
                barMid,
                barTop + barH,
                SOLID,
                COLOR_THEME_SECONDARY1
            )
            lcd.drawRectangle(x, rowTop, w, rowH + 1)
            lcd.setColor(CUSTOM_COLOR, txtColor)
            lcd.drawText(
                x + barW - 10,
                barTop - 2,
                tostring(chanVal) .. "%",
                bit32.bor(
                    bit32.bor(SMLSIZE, CUSTOM_COLOR),
                    RIGHT
                )
            )
            local output = model.getOutput(curChan - 1)
            if #output.name > 0 then
                lcd.drawText(
                    barLft + 1,
                    barTop - 2,
                    (__TS__StringPadStart(
                        tostring(curChan),
                        2,
                        "0"
                    ) .. " ") .. output.name,
                    bit32.bor(
                        bit32.bor(SMLSIZE, CUSTOM_COLOR),
                        LEFT
                    )
                )
            else
                lcd.drawText(
                    barLft + 1,
                    barTop - 2,
                    "CH" .. tostring(curChan),
                    bit32.bor(
                        bit32.bor(SMLSIZE, CUSTOM_COLOR),
                        LEFT
                    )
                )
            end
            curChan = curChan + 1
        end
    end
    return lastChan - 1
end
local function twoColumns(widget, x, y, w, h)
    local endColumn = drawChannels(
        widget,
        0,
        0,
        w / 2 - 1,
        h,
        widget.options.FirstChannel
    )
    drawChannels(
        widget,
        w / 2,
        0,
        w / 2 - 1,
        h,
        endColumn + 1
    )
end
local function oneColumn(widget, x, y, w, h)
    drawChannels(
        widget,
        0,
        0,
        w,
        h,
        widget.options.FirstChannel
    )
end
local function draw(widget, x, y, w, h)
    if w > 300 and h > 20 then
        twoColumns(
            widget,
            x,
            y,
            w,
            h
        )
    elseif w > 100 and h > 20 then
        oneColumn(
            widget,
            x,
            y,
            w,
            h
        )
    end
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
