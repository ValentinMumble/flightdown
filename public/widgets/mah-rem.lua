-- Lua Library inline imports
local function __TS__Number(value)
    local valueType = type(value)
    if valueType == "number" then
        return value
    elseif valueType == "string" then
        local numberValue = tonumber(value)
        if numberValue then
            return numberValue
        end
        if value == "Infinity" then
            return math.huge
        end
        if value == "-Infinity" then
            return -math.huge
        end
        local stringWithoutSpaces = string.gsub(value, "%s", "")
        if stringWithoutSpaces == "" then
            return 0
        end
        return 0 / 0
    elseif valueType == "boolean" then
        return value and 1 or 0
    else
        return 0 / 0
    end
end
-- End of Lua Library inline imports
local ____exports = {}
local name = "Flight Battery Monitor"
local VoltageSensor = "VFAS"
local mAhSensor = "mAh"
local CurrentSensor = "Curr"
local CapacityReservePercent = 0
local SwReset = "sh"
local CellFullVoltage = 4
local VoltageDelta = 0.3
local soundDirPath = "/WIDGETS/mahRem/sounds/"
local AnnouncePercentRemaining = true
local GV = {
    [1] = 0,
    [2] = 1,
    [3] = 2,
    [4] = 3,
    [5] = 4,
    [6] = 5,
    [7] = 6,
    [8] = 7,
    [9] = 8
}
local GVCellCount = GV[6]
local GVBatCap = GV[7]
local GVFlightMode = 0
local WriteGVBatRemmAh = false
local WriteGVBatRemPer = false
local GVBatRemmAh = GV[8]
local GVBatRemPer = GV[9]
local DEBUG = false
local CanCallInitFuncAgain = false
local UseVoltsNotmAh
local BatCapFullmAh
local BatCapmAh
local BatUsedmAh
local BatRemainmAh
local BatRemPer
local VoltsPercentRem
local VoltsNow = 0
local CellCount
local VoltsMax
local VoltageHistory = {}
local CheckBatNotFull = true
local StartTime = getTime()
local PlayFirstInconsistentCellWarning = true
local PlayInconsistentCellWarning = false
local PlayFirstMissingCellWarning = true
local PlayMissingCellWarning = true
local InconsistentCellVoltageDetected = false
local ResetDebounced = true
local MaxWatts = "////-"
local MaxAmps = "////-"
local BatRemPerFileName = ""
local BatRemPerPlayed = 0
local AtZeroPlayedCount
local PlayAtZero = 1
local x
local y
local fontSize
local yColumn2
local xAlign = 0
local BlinkWhenZero = 0
local Color = GREY
local VoltToPercentTable = {
    {3.6, 10},
    {3.7, 15},
    {3.72, 20},
    {3.74, 25},
    {3.76, 30},
    {3.78, 35},
    {3.8, 40},
    {3.81, 45},
    {3.83, 50},
    {3.85, 55},
    {3.87, 60},
    {3.98, 65},
    {3.99, 70},
    {4, 75},
    {4.03, 80},
    {4.06, 85},
    {4.1, 90},
    {4.15, 95},
    {4.2, 100}
}
local SoundsTable = {
    [5] = "Bat5L.wav",
    [10] = "Bat10L.wav",
    [20] = "Bat20L.wav",
    [30] = "Bat30L.wav",
    [40] = "Bat40L.wav",
    [50] = "Bat50L.wav",
    [60] = "Bat60L.wav",
    [70] = "Bat70L.wav",
    [80] = "Bat80L.wav",
    [90] = "Bat90L.wav"
}
local function getCellVoltage(voltageSensorIn)
    local cellResult = getValue(voltageSensorIn)
    local cellSum = 0
    if type(cellResult) == "table" then
    else
        cellSum = cellResult
    end
    return cellSum
end
local function getMaxWatts(voltsNow)
    if CurrentSensor ~= "" then
        local amps = getValue(CurrentSensor)
        if type(amps) == "number" then
            if type(MaxAmps) == "string" or type(MaxAmps) == "number" and amps > __TS__Number(MaxAmps) then
                MaxAmps = tostring(amps)
            end
            local watts = amps * voltsNow
            if type(MaxWatts) == "string" or watts > __TS__Number(MaxWatts) then
                MaxWatts = tostring(watts)
            end
        end
    end
end
local function findPercentRem(cellVoltage)
    if cellVoltage > 4.2 then
        return 100
    elseif cellVoltage < 3.6 then
        return 0
    else
        return 0
    end
end
local function PlayPercentRemaining()
    local myModVal
    if BatRemPer < 10 then
        myModVal = BatRemPer % 5
    else
        myModVal = BatRemPer % 10
    end
    if myModVal == 0 and BatRemPer ~= BatRemPerPlayed then
        BatRemPerFileName = SoundsTable[BatRemPer]
        if BatRemPerFileName ~= nil then
            playFile(soundDirPath .. BatRemPerFileName)
            BatRemPerPlayed = BatRemPer
        end
    end
    if BatRemPer <= 0 and AtZeroPlayedCount < PlayAtZero and getRSSI() > 0 then
        print(BatRemPer, AtZeroPlayedCount)
        playFile(soundDirPath .. "BatNo.wav")
        AtZeroPlayedCount = AtZeroPlayedCount + 1
    elseif AtZeroPlayedCount == PlayAtZero and BatRemPer > 0 then
        AtZeroPlayedCount = 0
    end
end
local function HasSecondsElapsed(numSeconds)
    if StartTime == nil then
        StartTime = getTime()
    end
    local currTime = getTime()
    local deltaTime = currTime - StartTime
    local deltaSeconds = deltaTime / 100
    local deltaTimeMod = deltaSeconds % numSeconds
    if math.abs(deltaTimeMod - 0) < 1 then
        return true
    else
        return false
    end
end
local function check_for_full_battery(voltageSensorValue)
    if BatUsedmAh == 0 then
        if CheckBatNotFull then
            local playBatNotFullWarning = false
            if type(voltageSensorValue) == "table" then
                print("flvss cell detection")
                CheckBatNotFull = false
            elseif VoltageSensor == "VFAS" and type(voltageSensorValue) == "number" then
                print(string.format("vfas: %f", voltageSensorValue))
                if voltageSensorValue < CellFullVoltage - 0.001 then
                    local playBatNotFullWarning = true
                end
                CheckBatNotFull = false
            end
            if playBatNotFullWarning then
                playFile(soundDirPath .. "BNFull.wav")
            end
        end
    end
end
local function check_cell_delta_voltage(voltageSensorValue)
    if type(voltageSensorValue) == "table" then
    end
end
local function voltage_sensor_tests()
    if VoltageSensor ~= "" then
        local cellResult = getValue(VoltageSensor)
        check_for_full_battery(cellResult)
        check_cell_delta_voltage(cellResult)
    end
end
local function init_func()
    BatCapFullmAh = model.getGlobalVariable(GVBatCap, GVFlightMode) * 100
    BatCapmAh = BatCapFullmAh * (100 - CapacityReservePercent) / 100
    BatRemainmAh = BatCapmAh
    CellCount = model.getGlobalVariable(GVCellCount, GVFlightMode)
    VoltsPercentRem = 0
    BatRemPer = 0
    AtZeroPlayedCount = 0
    if mAhSensor == "" or BatCapmAh == 0 then
        UseVoltsNotmAh = true
    else
        UseVoltsNotmAh = false
    end
end
local function reset_if_needed()
    if SwReset ~= "" then
        if ResetDebounced and HasSecondsElapsed(2) and -1024 ~= getValue(SwReset) then
            print("reset switch toggled")
            CheckBatNotFull = true
            StartTime = nil
            PlayInconsistentCellWarning = true
            PlayFirstMissingCellWarning = true
            PlayMissingCellWarning = true
            PlayFirstInconsistentCellWarning = true
            InconsistentCellVoltageDetected = false
            VoltageHistory = {}
            ResetDebounced = false
            VoltsNow = 0
            MaxWatts = "////-"
            MaxAmps = "////-"
        end
        if not HasSecondsElapsed(2) then
            ResetDebounced = true
        end
    end
end
local function bg_func()
    reset_if_needed()
    if BatCapFullmAh ~= model.getGlobalVariable(GVBatCap, GVFlightMode) * 100 then
        init_func()
    end
    if mAhSensor ~= "" then
        BatUsedmAh = getValue(mAhSensor)
        if BatUsedmAh == 0 and CanCallInitFuncAgain then
            init_func()
            CanCallInitFuncAgain = false
        elseif BatUsedmAh > 0 then
            CanCallInitFuncAgain = true
        end
        BatRemainmAh = BatCapmAh - BatUsedmAh
    end
    if VoltageSensor ~= "" then
        local volts = getCellVoltage(VoltageSensor)
        if VoltsNow < 1 or volts > 1 then
            VoltsNow = volts
        end
        VoltsMax = getCellVoltage(tostring(VoltageSensor) .. "+")
        getMaxWatts(VoltsNow)
        if CellCount > 0 then
            VoltsPercentRem = findPercentRem(VoltsNow / CellCount)
        end
    end
    if UseVoltsNotmAh then
        BatRemPer = VoltsPercentRem - CapacityReservePercent
    elseif BatCapmAh > 0 then
        BatRemPer = math.floor(BatRemainmAh / BatCapFullmAh * 100)
    end
    if AnnouncePercentRemaining then
        PlayPercentRemaining()
    end
    if WriteGVBatRemmAh == true then
        model.setGlobalVariable(
            GVBatRemmAh,
            GVFlightMode,
            math.floor(BatRemainmAh / 100)
        )
    end
    if WriteGVBatRemPer == true then
        model.setGlobalVariable(GVBatRemPer, GVFlightMode, BatRemPer)
    end
    voltage_sensor_tests()
end
local function getPercentColor(cpercent)
    if cpercent < 30 then
        return lcd.RGB(255, 0, 0)
    else
        local g = math.floor(223 * cpercent / 100)
        local r = 223 - g
        return lcd.RGB(r, g, 0)
    end
end
local function formatCellVoltage(voltage)
    if type(voltage) == "number" then
    else
    end
end
local function drawCellVoltage(wgt)
    local cellResult = getValue(VoltageSensor)
end
local function drawBattery(xOrigin, yOrigin, wgt)
    local volts = getCellVoltage(VoltageSensor)
    if 0 == volts then
        lcd.drawText(50, 20, "No telemetry")
        return
    end
    local myBatt = {
        x = xOrigin,
        y = yOrigin,
        w = 85,
        h = 35,
        segments_w = 15,
        color = WHITE,
        cath_w = 6,
        cath_h = 20
    }
    lcd.setColor(CUSTOM_COLOR, wgt.options.Color)
    if BatRemPer > 0 then
        BlinkWhenZero = 0
    else
        BlinkWhenZero = BLINK
    end
    lcd.setColor(
        CUSTOM_COLOR,
        getPercentColor(BatRemPer)
    )
    lcd.drawGauge(
        wgt.zone.x + myBatt.x,
        wgt.zone.y + myBatt.y,
        myBatt.w,
        myBatt.h,
        BatRemPer,
        100,
        CUSTOM_COLOR
    )
    lcd.setColor(CUSTOM_COLOR, WHITE)
    lcd.drawRectangle(
        wgt.zone.x + myBatt.x,
        wgt.zone.y + myBatt.y,
        myBatt.w,
        myBatt.h,
        CUSTOM_COLOR,
        2
    )
    lcd.drawFilledRectangle(
        wgt.zone.x + myBatt.x + myBatt.w,
        wgt.zone.y + myBatt.y + myBatt.cath_h / 2 - 2.5,
        myBatt.cath_w,
        myBatt.cath_h,
        CUSTOM_COLOR
    )
    lcd.drawText(
        wgt.zone.x + myBatt.x + 20,
        wgt.zone.y + myBatt.y + 5,
        string.format("%d%%", BatRemPer),
        LEFT + MIDSIZE + CUSTOM_COLOR
    )
    lcd.drawText(
        wgt.zone.x + myBatt.x,
        wgt.zone.y + myBatt.y + 35,
        string.format("%d mAh", BatRemainmAh),
        DBLSIZE + Color + BlinkWhenZero
    )
    lcd.drawText(
        wgt.zone.x + myBatt.x + myBatt.cath_w + myBatt.w + 15,
        wgt.zone.y,
        string.format("%.1f V", volts),
        DBLSIZE
    )
end
local function refreshZoneTiny(wgt)
    local myString = string.format("%d", BatRemainmAh)
    lcd.drawText(
        wgt.zone.x + wgt.zone.w - 25,
        wgt.zone.y + 5,
        tostring(BatRemPer) .. "%",
        RIGHT + SMLSIZE + CUSTOM_COLOR + BlinkWhenZero
    )
    lcd.drawText(wgt.zone.x + wgt.zone.w - 25, wgt.zone.y + 20, myString, RIGHT + SMLSIZE + CUSTOM_COLOR + BlinkWhenZero)
    lcd.drawRectangle(
        wgt.zone.x + 50,
        wgt.zone.y + 9,
        16,
        25,
        CUSTOM_COLOR,
        2
    )
    lcd.drawFilledRectangle(
        wgt.zone.x + 50 + 4,
        wgt.zone.y + 7,
        6,
        3,
        CUSTOM_COLOR
    )
    local rect_h = math.floor(25 * BatRemPer / 100)
    lcd.drawFilledRectangle(
        wgt.zone.x + 50,
        wgt.zone.y + 9 + 25 - rect_h,
        16,
        rect_h,
        CUSTOM_COLOR + BlinkWhenZero
    )
end
local function refreshZoneSmall(wgt)
    local myBatt = {
        x = 0,
        y = 0,
        w = 155,
        h = 35,
        segments_w = 25,
        color = WHITE,
        cath_w = 6,
        cath_h = 20
    }
    lcd.setColor(CUSTOM_COLOR, WHITE)
    lcd.drawRectangle(
        wgt.zone.x + myBatt.x,
        wgt.zone.y + myBatt.y,
        myBatt.w,
        myBatt.h,
        CUSTOM_COLOR,
        2
    )
    lcd.setColor(
        CUSTOM_COLOR,
        getPercentColor(BatRemPer)
    )
    lcd.drawGauge(
        wgt.zone.x + 2,
        wgt.zone.y + 2,
        myBatt.w - 4,
        wgt.zone.h,
        BatRemPer,
        100,
        CUSTOM_COLOR
    )
    lcd.setColor(CUSTOM_COLOR, wgt.options.Color)
    local topLine = string.format("%d      %d%%", BatRemainmAh, BatRemPer)
    lcd.drawText(wgt.zone.x + 20, wgt.zone.y + 2, topLine, MIDSIZE + CUSTOM_COLOR + BlinkWhenZero)
end
local function refreshZoneMedium(wgt)
    drawBattery(0, 0, wgt)
end
local function refreshZoneLarge(wgt)
    lcd.setColor(CUSTOM_COLOR, wgt.options.Color)
    fontSize = 10
    if BatRemPer > 0 then
        BlinkWhenZero = 0
    else
        BlinkWhenZero = BLINK
    end
    lcd.drawText(wgt.zone.x + 5, wgt.zone.y + fontSize, "BATTERY LEFT", SHADOWED)
    lcd.setColor(
        CUSTOM_COLOR,
        getPercentColor(BatRemPer)
    )
    lcd.drawText(
        wgt.zone.x + 5,
        wgt.zone.y + fontSize + 25,
        tostring(math.floor(BatRemPer)) .. "%",
        DBLSIZE + SHADOWED + BlinkWhenZero
    )
    lcd.drawText(
        wgt.zone.x + 5,
        wgt.zone.y + fontSize + 55,
        tostring(math.floor(BatRemainmAh)) .. "mAh",
        DBLSIZE + SHADOWED + BlinkWhenZero
    )
    lcd.setColor(CUSTOM_COLOR, wgt.options.Color)
    lcd.drawRectangle(
        wgt.zone.x - 1,
        wgt.zone.y + (wgt.zone.h - 31),
        wgt.zone.w + 2,
        32,
        0
    )
    lcd.setColor(
        CUSTOM_COLOR,
        getPercentColor(BatRemPer)
    )
    lcd.drawGauge(
        wgt.zone.x,
        wgt.zone.y + (wgt.zone.h - 30),
        wgt.zone.w,
        30,
        BatRemPer,
        100,
        BlinkWhenZero
    )
end
local function refreshZoneXLarge(widget)
    lcd.setColor(CUSTOM_COLOR, widget.options.Color)
    fontSize = 10
    if BatRemPer > 0 then
        BlinkWhenZero = 0
    else
        BlinkWhenZero = BLINK
    end
    drawCellVoltage(widget)
    drawBattery(0, 100, widget)
    lcd.drawText(widget.zone.x + 210, widget.zone.y + -5, "Current/Max", DBLSIZE + Color + SHADOWED)
    local amps = getValue(CurrentSensor)
    lcd.drawText(
        widget.zone.x + 210,
        widget.zone.y + 30,
        string.format("%.0fA/%.0fA", amps, MaxAmps),
        MIDSIZE + Color
    )
    local watts = math.floor(amps * VoltsNow)
    local sMaxWatts
    if type(MaxWatts) == "string" then
        sMaxWatts = MaxWatts
    elseif type(MaxWatts) == "number" then
        sMaxWatts = string.format("%.0f", MaxWatts)
    end
    lcd.drawText(
        widget.zone.x + 210,
        widget.zone.y + 55,
        string.format("%.0fW/%sW", watts, sMaxWatts),
        MIDSIZE + Color
    )
    lcd.drawText(
        widget.zone.x + 185,
        widget.zone.y + 85,
        string.format("%.2fV", VoltsNow),
        XXLSIZE + Color
    )
end
local function run_func(widget)
    bg_func()
    if widget.zone.w > 380 and widget.zone.h > 165 then
        refreshZoneXLarge(widget)
    elseif widget.zone.w > 180 and widget.zone.h > 145 then
        refreshZoneLarge(widget)
    elseif widget.zone.w > 170 and widget.zone.h > 65 then
        refreshZoneMedium(widget)
    elseif widget.zone.w > 150 and widget.zone.h > 28 then
        refreshZoneSmall(widget)
    elseif widget.zone.w > 65 and widget.zone.h > 35 then
        refreshZoneTiny(widget)
    end
end
local function create(zone, options)
    init_func()
    return {zone = zone, options = options}
end
local function update(Context, options)
    mAhSensor = options.mAh
    VoltageSensor = options.Voltage
    CurrentSensor = options.Current
    Color = options.Color
    Context.options = options
    Context.back = nil
end
local function background()
    bg_func()
end
local function refresh(widget)
    run_func(widget)
end
local options = {{"mAh", SOURCE, 279}, {"Voltage", SOURCE, 276}, {"Current", SOURCE, 273}, {"Color", COLOR, WHITE}}
____exports.name = name
____exports.options = options
____exports.create = create
____exports.update = update
____exports.refresh = refresh
____exports.background = background
return ____exports
