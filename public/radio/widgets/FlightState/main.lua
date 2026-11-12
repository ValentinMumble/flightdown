local ____exports = {}
local name = "FlightState"
--- How the heli is set to fly, beside the flight mode the top bar shows (FMStatus): the gyro on SC and the throttle hold
-- on SF, as two lights. While SH is held down (the rescue), the zone turns red and says RESCUE.
local options = {{"GyroSource", SOURCE, 1}, {"HoldSource", SOURCE, 1}}
local function create(zone, options)
    return {zone = zone, options = options}
end
local function update(widget, options)
    widget.options = options
end
--- Text centred in a box.
local function centered(x, y, width, height, text, flags)
    local ____, textHeight = lcd.sizeText(text, flags)
    lcd.drawText(
        x + math.floor(width / 2),
        y + math.floor((height - textHeight) / 2),
        text,
        flags + CENTER
    )
end
--- A state light: its word, filled in `color` when on, outlined when off.
local function light(x, y, width, height, word, on, color)
    if on then
        lcd.drawFilledRectangle(
            x,
            y,
            width,
            height,
            lcd.RGB(color)
        )
    else
        lcd.drawRectangle(
            x,
            y,
            width,
            height,
            lcd.RGB(6120816),
            2
        )
    end
    centered(
        x,
        y,
        width,
        height,
        word,
        MIDSIZE + BOLD + (on and lcd.RGB(1053720) or lcd.RGB(10134445))
    )
end
local function draw(widget, width, height)
    if getValue("sh") > 0 then
        lcd.drawFilledRectangle(
            0,
            0,
            width,
            height,
            lcd.RGB(9051168)
        )
        lcd.drawText(
            6,
            2,
            "SH held",
            SMLSIZE + lcd.RGB(16765650)
        )
        centered(
            0,
            0,
            width,
            height,
            "RESCUE",
            DBLSIZE + BOLD + lcd.RGB(16777215)
        )
        return
    end
    local gyro = getValue(widget.options.GyroSource or "sc") >= 1024
    local hold = getValue(widget.options.HoldSource or "sf") ~= -1024
    local gap = 8
    local lightWidth = math.floor((width - 12 - gap) / 2)
    local lightHeight = math.min(44, height - 12)
    local y = math.floor((height - lightHeight) / 2)
    light(
        6,
        y,
        lightWidth,
        lightHeight,
        gyro and "GYRO ON" or "GYRO OFF",
        gyro,
        3907327
    )
    light(
        6 + lightWidth + gap,
        y,
        lightWidth,
        lightHeight,
        hold and "HOLD" or "THR ON",
        hold,
        16756768
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
