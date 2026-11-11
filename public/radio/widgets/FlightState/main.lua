local ____exports = {}
local name = "FlightState"
--- How the heli is set to fly, in one place: the flight mode on SE (IU 1, IU 2, IU 3, as FMStatus names them), the gyro
-- on SC, and the throttle hold on SF.
local options = {{"FlightModeSource", SOURCE, 1}, {"GyroSource", SOURCE, 1}, {"HoldSource", SOURCE, 1}}
local function create(zone, options)
    return {zone = zone, options = options}
end
local function update(widget, options)
    widget.options = options
end
--- A state chip: its word, filled in `color` when on, outlined when off.
local function chip(x, y, width, word, on, color)
    if on then
        lcd.drawFilledRectangle(
            x,
            y,
            width,
            18,
            lcd.RGB(color)
        )
    else
        lcd.drawRectangle(
            x,
            y,
            width,
            18,
            lcd.RGB(6120816)
        )
    end
    lcd.drawText(
        x + width / 2,
        y + 2,
        word,
        SMLSIZE + CENTER + (on and lcd.RGB(1053720) or lcd.RGB(10134445))
    )
end
local function draw(widget, width, height)
    local mode = getValue(widget.options.FlightModeSource or "se")
    local gyro = getValue(widget.options.GyroSource or "sc") >= 1024
    local hold = getValue(widget.options.HoldSource or "sf") ~= -1024
    local label = mode <= -512 and "IU 1" or (mode >= 512 and "IU 3" or "IU 2")
    lcd.drawText(
        6,
        2,
        "Flight mode",
        SMLSIZE + lcd.RGB(10134445)
    )
    lcd.drawText(
        6,
        16,
        label,
        (height >= 60 and DBLSIZE or MIDSIZE) + BOLD + lcd.RGB(15658734)
    )
    local chipWidth = math.min(
        80,
        math.floor((width - 18) / 2)
    )
    local y = height - 22
    chip(
        width - 2 * chipWidth - 10,
        y,
        chipWidth,
        gyro and "GYRO ON" or "GYRO OFF",
        gyro,
        3907327
    )
    chip(
        width - chipWidth - 6,
        y,
        chipWidth,
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
