local ____exports = {}
local name = "Timer"
local options = {{"TimerSource", TIMER, 0}}
local function update(widget, options)
    widget.options = options
end
local function create(zone, options)
    local current_path = "/WIDGETS/" .. name
    local bg = Bitmap.open(current_path .. "/mask_timer_bg.png")
    local rs = Bitmap.open(current_path .. "/mask_rscale.png")
    local tm = Bitmap.open(current_path .. "/mask_timer.png")
    local modelInfo = model.getInfo()
    local widget = {
        zone = zone,
        options = options,
        bg = Bitmap.toMask(bg),
        rs = Bitmap.toMask(rs),
        tm = Bitmap.toMask(tm)
    }
    update(widget, options)
    return widget
end
local SECONDSPERMIN = 60
local SECONDSPERHOUR = 60 * SECONDSPERMIN
local SECONDSPERDAY = 24 * SECONDSPERHOUR
local SECONDSPERYEAR = 365 * SECONDSPERDAY
local function splitTimer(tme)
    local yy = math.floor(tme / SECONDSPERYEAR)
    tme = tme - yy * SECONDSPERYEAR
    local dd = math.floor(tme / SECONDSPERDAY)
    tme = tme - dd * SECONDSPERDAY
    local hh = math.floor(tme / SECONDSPERHOUR)
    tme = tme - hh * SECONDSPERHOUR
    local mm = math.floor(tme / SECONDSPERMIN)
    tme = tme - mm * SECONDSPERMIN
    local ss = math.floor(tme)
    if yy == 0 and dd == 0 and hh == 0 then
        return {
            string.format("%02d", mm),
            string.format("%02d", ss),
            "M",
            "S"
        }
    elseif yy == 0 and dd == 0 then
        return {
            string.format("%02d", hh),
            string.format("%02d", mm),
            "H",
            "M"
        }
    elseif yy == 0 then
        return {
            string.format("%02d", dd),
            string.format("%02d", hh),
            "D",
            "H"
        }
    else
        return {
            string.format("%02d", yy),
            string.format("%02d", dd),
            "Y",
            "D"
        }
    end
end
local function draw(widget, x, y, width, height)
    local timer = model.getTimer(widget.options.TimerSource)
    if width >= 180 and height >= 70 then
        local colorBack = (timer.value >= 0 or timer.value % 2 == 0) and COLOR_THEME_PRIMARY2 or COLOR_THEME_WARNING
        local colorFore = (timer.value >= 0 or timer.value % 2 == 0) and COLOR_THEME_SECONDARY1 or COLOR_THEME_SECONDARY2
        lcd.drawBitmapPattern(widget.bg, 0, 0, colorBack)
        if timer.start and timer.value >= 0 then
            lcd.drawBitmapPatternPie(
                widget.rs,
                2,
                3,
                0,
                timer.value <= 0 and 360 or 360 * (timer.start - timer.value) / timer.start,
                colorFore
            )
        else
            lcd.drawBitmapPattern(widget.tm, 3, 4, colorFore)
        end
        local val = timer.value
        if timer.start and timer.showElapsed and timer.start ~= timer.value then
            val = timer.start - timer.value
        end
        local sDigitGroup0, sDigitGroup1, sUnit0, sUnit1 = table.unpack(splitTimer(math.abs(val)))
        lcd.drawText(
            76,
            31,
            sDigitGroup0,
            bit32.bor(DBLSIZE, colorFore)
        )
        lcd.drawText(76 + 35, 33, sUnit0, colorFore)
        lcd.drawText(
            76 + 50,
            31,
            sDigitGroup1,
            bit32.bor(DBLSIZE, colorFore)
        )
        lcd.drawText(76 + 85, 33, sUnit1, colorFore)
        if #timer.name > 0 then
            lcd.drawText(
                78,
                20,
                timer.name,
                bit32.bor(SMLSIZE, colorFore)
            )
        else
            lcd.drawText(
                137,
                17,
                "TMR" .. tostring(widget.options.TimerSource + 1),
                bit32.bor(SMLSIZE, colorFore)
            )
        end
    else
        if timer.value < 0 and timer.value % 2 then
            lcd.drawFilledRectangle(
                0,
                0,
                width,
                height,
                COLOR_THEME_WARNING
            )
        end
        if #timer.name > 0 then
            lcd.drawText(
                2,
                0,
                timer.name,
                bit32.bor(SMLSIZE, COLOR_THEME_PRIMARY2)
            )
        else
            lcd.drawText(
                2,
                0,
                "TMR" .. tostring(widget.options.TimerSource + 1),
                bit32.bor(SMLSIZE, COLOR_THEME_PRIMARY2)
            )
        end
        local val = timer.value
        if timer.start and timer.showElapsed and timer.start ~= timer.value then
            val = timer.start - timer.value
        end
        if width > 100 and height > 40 then
            if math.abs(val) >= 3600 then
                lcd.drawTimer(
                    3,
                    20,
                    math.abs(val),
                    bit32.bor(
                        bit32.bor(COLOR_THEME_PRIMARY2, LEFT),
                        TIMEHOUR
                    )
                )
            else
                lcd.drawTimer(
                    3,
                    18,
                    math.abs(val),
                    bit32.bor(COLOR_THEME_PRIMARY2, LEFT)
                )
            end
        else
            if math.abs(timer.value) >= 3600 then
                lcd.drawTimer(
                    3,
                    20,
                    math.abs(timer.value),
                    bit32.bor(
                        bit32.bor(
                            bit32.bor(COLOR_THEME_PRIMARY2, LEFT),
                            SMLSIZE
                        ),
                        TIMEHOUR
                    )
                )
            else
                local val = timer.value
                if timer.start and timer.showElapsed and timer.start ~= timer.value then
                    val = timer.start - timer.value
                end
                lcd.drawTimer(
                    3,
                    18,
                    math.abs(val),
                    bit32.bor(COLOR_THEME_PRIMARY2, LEFT)
                )
            end
        end
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
