local ____exports = {}
local drawVoltage
function drawVoltage(widget)
    if widget.zone.h == 169 then
        lcd.drawText(
            widget.zone.w * 0.7,
            widget.zone.h * 0.68,
            string.format("%.2fv", widget.voltage / widget.options.Cells),
            CENTER + VCENTER + 0 + WHITE
        )
        lcd.drawText(
            widget.zone.w * 0.7,
            widget.zone.h * 0.82,
            string.format("%.2fv", widget.voltage),
            CENTER + VCENTER + DBLSIZE + WHITE
        )
    else
        lcd.drawText(
            widget.zone.w / 2,
            widget.zone.h * 0.28,
            string.format("%.2fv", widget.voltage / widget.options.Cells),
            CENTER + VCENTER + 0 + WHITE
        )
        lcd.drawText(
            widget.zone.w / 2,
            widget.zone.h * 0.62,
            string.format("%.2fv", widget.voltage),
            CENTER + VCENTER + MIDSIZE + WHITE
        )
    end
end
local NAME = "Battery"
local COLOR_LOW = {red = 188, green = 71, blue = 54}
local COLOR_MED = {red = 234, green = 196, blue = 69}
local COLOR_HIGH = {red = 79, green = 121, blue = 66}
local options = {
    {"BattSensor", SOURCE, 276},
    {
        "Cells",
        VALUE,
        3,
        1,
        12
    },
    {
        "CellVMax",
        VALUE,
        420,
        400,
        435
    },
    {
        "CellVMin",
        VALUE,
        370,
        250,
        390
    },
    {"Alarm", BOOL, 1}
}
local function batteryWarning(widget)
    if widget.options.Alarm == 1 and widget.voltage < widget.CellVMin or widget.voltage > widget.CellVMax then
        if getTime() >= widget.waitTime then
            widget.waitTime = getTime() + 200
            playTone(
                2500,
                200,
                100,
                0,
                0
            )
            playTone(
                2500,
                200,
                0,
                0,
                0
            )
        end
    end
end
local function create(zone, options)
    local widget = {
        zone = zone,
        options = options,
        waitTime = getTime(),
        voltage = 0,
        CellVMax = 0,
        CellVMin = 0,
        pixSizeX = 0,
        pixSizeY = 0,
        picture = Bitmap.open(("/WIDGETS/Battery/battery_" .. tostring(zone.h)) .. ".png")
    }
    local pixSizeX, pixSizeY = Bitmap.getSize(widget.picture)
    widget.pixSizeX = pixSizeX
    widget.pixSizeY = pixSizeY
    widget.CellVMax = widget.options.CellVMax / 100 * widget.options.Cells
    widget.CellVMin = widget.options.CellVMin / 100 * widget.options.Cells
    return widget
end
local function update(widget, options)
    widget.options = options
    widget.CellVMax = widget.options.CellVMax / 100 * widget.options.Cells
    widget.CellVMin = widget.options.CellVMin / 100 * widget.options.Cells
end
local function background(widget)
    widget.voltage = getValue(widget.options.BattSensor)
    if widget.voltage ~= 0 then
        batteryWarning(widget)
    end
end
local function colorGradient(fadeFraction, rgbColor1, rgbColor2, rgbColor3)
    local color1 = rgbColor1
    local color2 = rgbColor2
    local fade = fadeFraction
    if rgbColor3 then
        fade = fade * 2
        if fade >= 1 then
            fade = fade - 1
            color1 = rgbColor2
            color2 = rgbColor3
        end
    end
    local diffRed = color2.red - color1.red
    local diffGreen = color2.green - color1.green
    local diffBlue = color2.blue - color1.blue
    return {
        red = math.floor(color1.red + diffRed * fade),
        green = math.floor(color1.green + diffGreen * fade),
        blue = math.floor(color1.blue + diffBlue * fade)
    }
end
local function refresh(widget)
    widget.voltage = getValue(widget.options.BattSensor)
    if 0 == widget.pixSizeX or 392 == widget.zone.w or 0 == widget.voltage then
        lcd.drawText(widget.zone.w / 2, widget.zone.h / 2, "No telemetry", CENTER + VCENTER)
        return
    end
    local steps = 0
    if widget.zone.h == 169 then
        steps = math.floor(144 / 100 * ((widget.voltage - widget.CellVMin) / ((widget.CellVMax - widget.CellVMin) / 100)))
    else
        steps = math.floor(167 / 100 * ((widget.voltage - widget.CellVMin) / ((widget.CellVMax - widget.CellVMin) / 100)))
    end
    local ____colorGradient_result_0 = colorGradient(steps / 167, COLOR_LOW, COLOR_MED, COLOR_HIGH)
    local red = ____colorGradient_result_0.red
    local green = ____colorGradient_result_0.green
    local blue = ____colorGradient_result_0.blue
    local color = lcd.RGB(red, green, blue)
    if steps >= 0 and steps <= 167 and widget.zone.h == 42 then
        lcd.drawFilledRectangle(
            11,
            3,
            steps,
            36,
            color
        )
    elseif steps >= 0 and steps <= 167 and widget.zone.h == 56 then
        lcd.drawFilledRectangle(
            11,
            3,
            steps,
            50,
            color
        )
    elseif steps >= 0 and steps <= 167 and widget.zone.h == 84 then
        lcd.drawFilledRectangle(
            11,
            3,
            steps,
            78,
            color
        )
    elseif steps >= 0 and steps <= 144 and widget.zone.h == 169 then
        lcd.drawFilledRectangle(
            3,
            144 - steps + 16,
            78,
            steps,
            color
        )
    else
        batteryWarning(widget)
    end
    lcd.drawBitmap(widget.picture, 0, 0)
    drawVoltage(widget)
end
____exports.name = NAME
____exports.options = options
____exports.create = create
____exports.update = update
____exports.refresh = refresh
____exports.background = background
return ____exports
