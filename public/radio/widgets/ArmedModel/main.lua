local ____exports = {}
local name = "ArmedModel"
local MIN_VALUE = -1024
local options = {{"ArmedSwitch", SOURCE, 1}, {"ThrottleCutSwitch", SOURCE, 1}}
--- The rotor's top speed on screen, in degrees every 10 ms: about 1.1 turns a second, the blur does the rest. Slow
-- enough that even at 5 frames a second a blade moves less than a quarter turn, so it never seems to turn backwards.
local FULL_SPEED = 4
--- How long it takes, in 10 ms ticks, to spool up from still to full speed, and to coast down after a cut.
local SPOOL_UP = 350
local SPOOL_DOWN = 600
local METAL = 13095130
local METAL_DARK = 6121848
local LIGHT_OFF = 4870232
local STATES = {safe = {
    word = "SAFE",
    fill = 2371626,
    ink = 8181402,
    blade = 9147292,
    tip = 9147292
}, armed = {
    word = "ARMED",
    fill = 4864016,
    ink = 16756768,
    blade = 14212579,
    tip = 16756768
}, live = {
    word = "LIVE",
    fill = 6035999,
    ink = 16734815,
    blade = 15133165,
    tip = 16694784
}}
local function create(zone, options)
    return {
        zone = zone,
        options = options,
        angle = 30,
        speed = 0,
        lastTime = getTime()
    }
end
local function update(widget, options)
    widget.options = options
end
--- A colour part way from one to another (share 0 to 1), as the radio cannot draw see-through circles.
local function mix(from, to, share)
    local function part(rgb, unit)
        return math.floor(rgb / unit) % 256
    end
    local function blend(unit)
        return math.floor(part(from, unit) + (part(to, unit) - part(from, unit)) * share)
    end
    return lcd.RGB(
        blend(65536),
        blend(256),
        blend(1)
    )
end
--- A point on a blade: `along` from the hub towards the tip, `across` towards the leading edge.
local function bladePoint(centerX, centerY, angle, along, across)
    local radians = angle * math.pi / 180
    local x = centerX + math.sin(radians) * along + math.cos(radians) * across
    local y = centerY - math.cos(radians) * along + math.sin(radians) * across
    return {
        math.floor(x + 0.5),
        math.floor(y + 0.5)
    }
end
--- A tapered strip along a blade, from `from` to `to` away from the hub: two filled triangles.
local function strip(centerX, centerY, angle, from, to, rootHalf, tipHalf, color)
    local x1, y1 = table.unpack(bladePoint(
        centerX,
        centerY,
        angle,
        from,
        -rootHalf
    ))
    local x2, y2 = table.unpack(bladePoint(
        centerX,
        centerY,
        angle,
        from,
        rootHalf
    ))
    local x3, y3 = table.unpack(bladePoint(
        centerX,
        centerY,
        angle,
        to,
        tipHalf
    ))
    local x4, y4 = table.unpack(bladePoint(
        centerX,
        centerY,
        angle,
        to,
        -tipHalf
    ))
    lcd.drawFilledTriangle(
        x1,
        y1,
        x2,
        y2,
        x3,
        y3,
        color
    )
    lcd.drawFilledTriangle(
        x1,
        y1,
        x3,
        y3,
        x4,
        y4,
        color
    )
end
--- The main rotor seen from above, as on Flightdown's cockpit: two blades with yellow tips, their grips and the head.
-- As it spools up the blades leave a blur behind them and the disc they sweep shows.
local function drawRotor(centerX, centerY, radius, angle, share, background, blade, tip)
    local hub = math.max(
        3,
        math.floor(radius * 0.16 + 0.5)
    )
    local half = math.max(1.5, radius * 0.06)
    local blades = {angle, angle + 180}
    if share > 0.05 then
        lcd.drawFilledCircle(
            centerX,
            centerY,
            radius,
            mix(background, blade, 0.08 * share)
        )
        lcd.drawCircle(
            centerX,
            centerY,
            radius,
            mix(background, blade, 0.3 * share)
        )
        for ____, pointing in ipairs(blades) do
            local at = math.floor(pointing) % 360
            lcd.drawPie(
                centerX,
                centerY,
                radius,
                at - math.floor(55 * share),
                at,
                mix(background, blade, 0.2 * share)
            )
            lcd.drawPie(
                centerX,
                centerY,
                radius,
                at - math.floor(22 * share),
                at,
                mix(background, blade, 0.42 * share)
            )
        end
    end
    for ____, at in ipairs(blades) do
        strip(
            centerX,
            centerY,
            at,
            hub * 0.9,
            radius - 1,
            half,
            half * 0.75,
            lcd.RGB(blade)
        )
        strip(
            centerX,
            centerY,
            at,
            radius * 0.84,
            radius - 1,
            half * 0.8,
            half * 0.75,
            lcd.RGB(tip)
        )
        local fromX, fromY = table.unpack(bladePoint(
            centerX,
            centerY,
            at,
            hub * 0.9,
            -half
        ))
        local toX, toY = table.unpack(bladePoint(
            centerX,
            centerY,
            at,
            radius * 0.84,
            -half * 0.8
        ))
        lcd.drawLine(
            fromX,
            fromY,
            toX,
            toY,
            SOLID,
            mix(blade, 0, 0.28)
        )
        strip(
            centerX,
            centerY,
            at,
            0,
            hub * 2.1,
            half * 1.6,
            half * 1.4,
            mix(METAL, 0, 0.1)
        )
    end
    lcd.drawFilledCircle(
        centerX,
        centerY,
        hub,
        lcd.RGB(METAL_DARK)
    )
    lcd.drawFilledCircle(
        centerX,
        centerY,
        math.max(
            2,
            math.floor(hub * 0.62)
        ),
        lcd.RGB(METAL)
    )
    lcd.drawFilledCircle(
        centerX,
        centerY,
        math.max(
            1,
            math.floor(hub * 0.25)
        ),
        mix(background, 0, 0.2)
    )
end
--- Spools the rotor up while armed with the throttle on, and lets it coast down after a cut or a disarm.
local function turn(widget, spinning)
    local now = getTime()
    local elapsed = math.min(
        50,
        math.max(0, now - widget.lastTime)
    )
    widget.lastTime = now
    if spinning then
        widget.speed = math.min(FULL_SPEED, widget.speed + FULL_SPEED / SPOOL_UP * elapsed)
    else
        widget.speed = math.max(0, widget.speed - FULL_SPEED / SPOOL_DOWN * elapsed)
    end
    widget.angle = (widget.angle + widget.speed * elapsed) % 360
    return widget.speed / FULL_SPEED
end
--- The model picture fitted to a box, kept until the model or the box changes.
local function picture(widget, file, width, height)
    local key = (((tostring(file) .. "@") .. tostring(width)) .. "x") .. tostring(height)
    if widget.pictureKey ~= key then
        widget.pictureKey = key
        widget.picture = nil
        local opened = file and Bitmap.open("/IMAGES/" .. file) or nil
        if opened ~= nil then
            widget.picture = Bitmap.resize(opened, width, height) or opened
        end
    end
    return widget.picture
end
--- A switch's light: a small pill with a lamp, lit in `color` when on, dark when off, and what it is for ("SA ARM"),
-- cut to the switch's name ("SA") when the pill is too narrow for both.
local function switchLight(x, y, width, label, on, color, background)
    lcd.drawFilledRectangle(
        x,
        y,
        width,
        16,
        mix(background, 0, 0.35)
    )
    lcd.drawFilledCircle(
        x + 8,
        y + 8,
        4,
        on and lcd.RGB(color) or lcd.RGB(LIGHT_OFF)
    )
    local labelWidth = lcd.sizeText(label, SMLSIZE)
    local shown = 15 + labelWidth + 3 <= width and label or string.sub(label, 1, 2)
    lcd.drawText(
        x + 15,
        y + 2,
        shown,
        SMLSIZE + (on and lcd.RGB(16777215) or lcd.RGB(10134445))
    )
end
local function draw(widget, width, height)
    local info = model.getInfo()
    local isArmed = getValue(widget.options.ArmedSwitch) == MIN_VALUE
    local isThrottleActive = getValue(widget.options.ThrottleCutSwitch) == MIN_VALUE
    local live = isArmed and isThrottleActive
    local share = turn(widget, live)
    local state = STATES[live and "live" or (isArmed and "armed" or "safe")]
    lcd.drawFilledRectangle(
        0,
        0,
        width,
        height,
        lcd.RGB(state.fill)
    )
    if live and getTime() % 100 < 60 then
        lcd.drawRectangle(
            0,
            0,
            width,
            height,
            lcd.RGB(state.ink),
            2
        )
    end
    if height >= 80 and width >= 150 then
        local radius = math.floor(math.min(height - 8, width * 0.45) / 2)
        local centerX = width - radius - 4
        local left = centerX - radius - 6
        drawRotor(
            centerX,
            math.floor(height / 2),
            radius,
            widget.angle,
            share,
            state.fill,
            state.blade,
            state.tip
        )
        lcd.drawText(
            6,
            0,
            state.word,
            MIDSIZE + BOLD + lcd.RGB(state.ink)
        )
        local wordWidth = lcd.sizeText(state.word, MIDSIZE + BOLD)
        local nameWidth = lcd.sizeText(info.name, SMLSIZE)
        if 6 + wordWidth + 8 + nameWidth <= left then
            lcd.drawText(
                left,
                9,
                info.name,
                SMLSIZE + RIGHT + lcd.RGB(12633805)
            )
        end
        local pill = math.min(
            64,
            math.floor((left - 10) / 2)
        )
        switchLight(
            6,
            28,
            pill,
            "SA ARM",
            isArmed,
            16756768,
            state.fill
        )
        switchLight(
            10 + pill,
            28,
            pill,
            "SF THR",
            isThrottleActive,
            16734815,
            state.fill
        )
        local bitmap = picture(widget, info.bitmap, left - 4, height - 48)
        if bitmap ~= nil then
            lcd.drawBitmap(bitmap, 4, 46)
        end
    else
        local radius = math.max(
            8,
            math.floor(height / 2) - 3
        )
        drawRotor(
            radius + 4,
            math.floor(height / 2),
            radius,
            widget.angle,
            share,
            state.fill,
            state.blade,
            state.tip
        )
        local x = radius * 2 + 12
        if width - x >= 60 then
            lcd.drawText(
                x,
                math.floor(height / 2) - 20,
                state.word,
                MIDSIZE + BOLD + lcd.RGB(state.ink)
            )
        end
        if width - x >= 116 and height >= 40 then
            switchLight(
                x,
                math.floor(height / 2) + 4,
                54,
                "SA ARM",
                isArmed,
                16756768,
                state.fill
            )
            switchLight(
                x + 58,
                math.floor(height / 2) + 4,
                54,
                "SF THR",
                isThrottleActive,
                16734815,
                state.fill
            )
        end
    end
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
