local ____exports = {}
local name = "Link"
--- The radio link: the signal (RSSI, dB) and the link quality (%) as bars that go amber, then red, at the radio's own
-- alarm levels.
local options = {}
local function create(zone)
    return {zone = zone}
end
local function update()
end
--- A meter: its name, its bar against a full value, its figure, coloured by the two warning levels.
local function meter(y, width, label, value, full, amber, red, unit)
    local color = value <= 0 and lcd.RGB(6120816) or (value < red and lcd.RGB(16734815) or (value < amber and lcd.RGB(16756768) or lcd.RGB(8181402)))
    lcd.drawText(
        6,
        y,
        label,
        SMLSIZE + lcd.RGB(10134445)
    )
    local barX = 44
    local barWidth = width - barX - 52
    lcd.drawFilledRectangle(
        barX,
        y + 3,
        barWidth,
        9,
        lcd.RGB(3817544)
    )
    lcd.drawFilledRectangle(
        barX,
        y + 3,
        math.floor(barWidth * math.max(
            0,
            math.min(1, value / full)
        )),
        9,
        color
    )
    lcd.drawText(
        width - 6,
        y,
        value > 0 and (tostring(math.floor(value)) .. " ") .. unit or "--",
        SMLSIZE + RIGHT + color
    )
end
local function draw(widget, width, height)
    local rssi = getValue("RSSI")
    local quality = getValue("TQly")
    lcd.drawText(
        6,
        2,
        "Link",
        SMLSIZE + lcd.RGB(10134445)
    )
    if rssi <= 0 and quality <= 0 then
        lcd.drawText(
            6,
            20,
            "No link",
            MIDSIZE + lcd.RGB(10134445)
        )
        return
    end
    local row = math.max(
        16,
        math.floor((height - 18) / 2)
    )
    meter(
        18,
        width,
        "RSSI",
        rssi,
        100,
        45,
        42,
        "dB"
    )
    meter(
        18 + row,
        width,
        "LQ",
        quality,
        100,
        70,
        50,
        "%"
    )
end
local function refresh(widget, event)
    if nil ~= event then
        draw(widget, LCD_W, LCD_H)
    else
        draw(widget, widget.zone.w, widget.zone.h)
    end
end
____exports.refresh = refresh
____exports.name = name
____exports.create = create
____exports.update = update
____exports.options = options
return ____exports
