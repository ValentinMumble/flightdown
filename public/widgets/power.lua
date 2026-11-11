local ____exports = {}
local name = "Power"
--- The power the heli draws: a round dial of amps with a peak marker, and the watts (pack volts times amps) beside it.
-- The peak starts again with a new pack.
local options = {{
    "MaxAmps",
    VALUE,
    40,
    10,
    200
}}
--- The dial's sweep: from 7:30 round to 4:30, as cockpit dials.
local FROM = 225
local SWEEP = 270
--- A new pack: its voltage back after none with the mAh count at 0. The model resets the count only when telemetry
-- stops while disarmed (SA), so a dropout in flight is not a new pack.
local NEW_PACK_MAH = 5
local function create(zone, options)
    return {zone = zone, options = options, peak = 0, powered = false}
end
local function update(widget, options)
    widget.options = options
end
local function draw(widget, width, height)
    local volts = getValue("VFAS")
    local amps = math.max(
        0,
        getValue("Curr")
    )
    local powered = volts > 0.5
    if powered and not widget.powered and getValue("mAh") < NEW_PACK_MAH then
        widget.peak = 0
    end
    widget.powered = powered
    if powered then
        widget.peak = math.max(widget.peak, amps)
    end
    local most = widget.options.MaxAmps or 40
    local function angle(value)
        return math.floor((FROM + math.min(most, value) / most * SWEEP) % 360)
    end
    local radius = math.max(
        10,
        math.floor(math.min(height - 6, width / 2) / 2)
    )
    local centerX = radius + 4
    local centerY = math.floor(height / 2) + 2
    lcd.drawAnnulus(
        centerX,
        centerY,
        radius - 5,
        radius,
        FROM,
        FROM + SWEEP - 360,
        lcd.RGB(3817544)
    )
    if amps > 0.2 then
        lcd.drawAnnulus(
            centerX,
            centerY,
            radius - 5,
            radius,
            FROM,
            angle(amps),
            lcd.RGB(16756768)
        )
    end
    if widget.peak > 0.2 then
        local at = angle(widget.peak)
        lcd.drawAnnulus(
            centerX,
            centerY,
            radius - 7,
            radius + 1,
            at - 2,
            at + 2,
            lcd.RGB(16734815)
        )
    end
    lcd.drawText(
        centerX,
        centerY,
        string.format("%.0f", amps),
        MIDSIZE + BOLD + CENTER + VCENTER + lcd.RGB(15658734)
    )
    lcd.drawText(
        centerX,
        centerY + 14,
        "A",
        SMLSIZE + CENTER + lcd.RGB(10134445)
    )
    local x = centerX + radius + 10
    lcd.drawText(
        x,
        2,
        "Power",
        SMLSIZE + lcd.RGB(10134445)
    )
    lcd.drawText(
        x,
        16,
        string.format("%.0f", volts * amps) .. " W",
        MIDSIZE + BOLD + lcd.RGB(15658734)
    )
    lcd.drawText(
        x,
        height - 18,
        ("peak " .. string.format("%.1f", widget.peak)) .. " A",
        SMLSIZE + lcd.RGB(16734815)
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
