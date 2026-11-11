-- Lua Library inline imports
local function __TS__Class(self)
    local c = {prototype = {}}
    c.prototype.__index = c.prototype
    c.prototype.constructor = c
    return c
end

local function __TS__New(target, ...)
    local instance = setmetatable({}, target.prototype)
    instance:____constructor(...)
    return instance
end

local function __TS__ClassExtends(target, base)
    target.____super = base
    local staticMetatable = setmetatable({__index = base}, base)
    setmetatable(target, staticMetatable)
    local baseMetatable = getmetatable(base)
    if baseMetatable then
        if type(baseMetatable.__index) == "function" then
            staticMetatable.__index = baseMetatable.__index
        end
        if type(baseMetatable.__newindex) == "function" then
            staticMetatable.__newindex = baseMetatable.__newindex
        end
    end
    setmetatable(target.prototype, base.prototype)
    if type(base.prototype.__index) == "function" then
        target.prototype.__index = base.prototype.__index
    end
    if type(base.prototype.__newindex) == "function" then
        target.prototype.__newindex = base.prototype.__newindex
    end
    if type(base.prototype.__tostring) == "function" then
        target.prototype.__tostring = base.prototype.__tostring
    end
end

local function __TS__ArrayForEach(self, callbackFn, thisArg)
    for i = 1, #self do
        callbackFn(thisArg, self[i], i - 1, self)
    end
end
-- End of Lua Library inline imports
local ____exports = {}
local game
local Point = __TS__Class()
Point.name = "Point"
function Point.prototype.____constructor(self, x, y)
    self.x = x
    self.y = y
end
local Shape = __TS__Class()
Shape.name = "Shape"
function Shape.prototype.____constructor(self)
    self.rotation = 0
end
function Shape.prototype.move(self, x, y)
    local newPoints = {}
    do
        local i = 0
        while i < #self.points do
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[i + 1].x + x, self.points[i + 1].y + y)
            i = i + 1
        end
    end
    return newPoints
end
function Shape.prototype.setPos(self, newPoints)
    self.points = newPoints
end
function Shape.prototype.drop(self)
    return self:move(0, 1)
end
function Shape.prototype.moveLeft(self)
    return self:move(-1, 0)
end
function Shape.prototype.moveRight(self)
    return self:move(1, 0)
end
local SquareShape = __TS__Class()
SquareShape.name = "SquareShape"
__TS__ClassExtends(SquareShape, Shape)
function SquareShape.prototype.____constructor(self, cols)
    Shape.prototype.____constructor(self)
    self.fillColor = lcd.RGB(0, 255, 0)
    local x = cols / 2
    local y = -2
    self.points = {}
    local ____self_points_0 = self.points
    ____self_points_0[#____self_points_0 + 1] = __TS__New(Point, x, y)
    local ____self_points_1 = self.points
    ____self_points_1[#____self_points_1 + 1] = __TS__New(Point, x + 1, y)
    local ____self_points_2 = self.points
    ____self_points_2[#____self_points_2 + 1] = __TS__New(Point, x, y + 1)
    local ____self_points_3 = self.points
    ____self_points_3[#____self_points_3 + 1] = __TS__New(Point, x + 1, y + 1)
end
function SquareShape.prototype.rotate(self, clockwise)
    return self.points
end
local LShape = __TS__Class()
LShape.name = "LShape"
__TS__ClassExtends(LShape, Shape)
function LShape.prototype.____constructor(self, leftHanded, cols)
    Shape.prototype.____constructor(self)
    self.leftHanded = leftHanded
    if leftHanded then
        self.fillColor = lcd.RGB(0, 128, 0)
    else
        self.fillColor = lcd.RGB(128, 255, 128)
    end
    local x = cols / 2
    local y = -2
    self.points = {}
    local ____self_points_4 = self.points
    ____self_points_4[#____self_points_4 + 1] = __TS__New(Point, x, y - 1)
    local ____self_points_5 = self.points
    ____self_points_5[#____self_points_5 + 1] = __TS__New(Point, x, y)
    local ____self_points_6 = self.points
    ____self_points_6[#____self_points_6 + 1] = __TS__New(Point, x, y + 1)
    local ____self_points_7 = self.points
    ____self_points_7[#____self_points_7 + 1] = __TS__New(Point, x + (leftHanded and -1 or 1), y + 1)
end
function LShape.prototype.rotate(self, clockwise)
    self.rotation = (self.rotation + (clockwise and 1 or -1)) % 4
    local newPoints = {}
    repeat
        local ____switch16 = self.rotation
        local ____cond16 = ____switch16 == 0
        if ____cond16 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y - 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y + 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + (self.leftHanded and -1 or 1), self.points[2].y + 1)
            break
        end
        ____cond16 = ____cond16 or ____switch16 == 1
        if ____cond16 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x - 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x - 1, self.points[2].y + (self.leftHanded and -1 or 1))
            break
        end
        ____cond16 = ____cond16 or ____switch16 == 2
        if ____cond16 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y + 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y - 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + (self.leftHanded and 1 or -1), self.points[2].y - 1)
            break
        end
        ____cond16 = ____cond16 or ____switch16 == 3
        if ____cond16 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x - 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y + (self.leftHanded and 1 or -1))
            break
        end
    until true
    return newPoints
end
local StepShape = __TS__Class()
StepShape.name = "StepShape"
__TS__ClassExtends(StepShape, Shape)
function StepShape.prototype.____constructor(self, leftHanded, cols)
    Shape.prototype.____constructor(self)
    if leftHanded then
        self.fillColor = lcd.RGB(0, 255, 255)
    else
        self.fillColor = lcd.RGB(255, 255, 0)
    end
    self.leftHanded = leftHanded
    local x = cols / 2
    local y = -1
    self.points = {}
    local ____self_points_8 = self.points
    ____self_points_8[#____self_points_8 + 1] = __TS__New(Point, x + (leftHanded and 1 or -1), y)
    local ____self_points_9 = self.points
    ____self_points_9[#____self_points_9 + 1] = __TS__New(Point, x, y)
    local ____self_points_10 = self.points
    ____self_points_10[#____self_points_10 + 1] = __TS__New(Point, x, y - 1)
    local ____self_points_11 = self.points
    ____self_points_11[#____self_points_11 + 1] = __TS__New(Point, x + (leftHanded and -1 or 1), y - 1)
end
function StepShape.prototype.rotate(self, clockwise)
    self.rotation = (self.rotation + (clockwise and 1 or -1)) % 2
    local newPoints = {}
    repeat
        local ____switch21 = self.rotation
        local ____cond21 = ____switch21 == 0
        if ____cond21 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + (self.leftHanded and 1 or -1), self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y - 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + (self.leftHanded and -1 or 1), self.points[2].y - 1)
            break
        end
        ____cond21 = ____cond21 or ____switch21 == 1
        if ____cond21 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y + (self.leftHanded and 1 or -1))
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y + (self.leftHanded and -1 or 1))
            break
        end
    until true
    return newPoints
end
local StraightShape = __TS__Class()
StraightShape.name = "StraightShape"
__TS__ClassExtends(StraightShape, Shape)
function StraightShape.prototype.____constructor(self, cols)
    Shape.prototype.____constructor(self)
    self.fillColor = lcd.RGB(0, 0, 255)
    local x = cols / 2
    local y = -2
    self.points = {}
    local ____self_points_12 = self.points
    ____self_points_12[#____self_points_12 + 1] = __TS__New(Point, x, y - 2)
    local ____self_points_13 = self.points
    ____self_points_13[#____self_points_13 + 1] = __TS__New(Point, x, y - 1)
    local ____self_points_14 = self.points
    ____self_points_14[#____self_points_14 + 1] = __TS__New(Point, x, y)
    local ____self_points_15 = self.points
    ____self_points_15[#____self_points_15 + 1] = __TS__New(Point, x, y + 1)
end
function StraightShape.prototype.rotate(self, clockwise)
    self.rotation = (self.rotation + (clockwise and 1 or -1)) % 2
    local newPoints = {}
    repeat
        local ____switch24 = self.rotation
        local ____cond24 = ____switch24 == 0
        if ____cond24 then
            newPoints[1] = __TS__New(Point, self.points[3].x, self.points[3].y - 2)
            newPoints[2] = __TS__New(Point, self.points[3].x, self.points[3].y - 1)
            newPoints[3] = __TS__New(Point, self.points[3].x, self.points[3].y)
            newPoints[4] = __TS__New(Point, self.points[3].x, self.points[3].y + 1)
            break
        end
        ____cond24 = ____cond24 or ____switch24 == 1
        if ____cond24 then
            newPoints[1] = __TS__New(Point, self.points[3].x + 2, self.points[3].y)
            newPoints[2] = __TS__New(Point, self.points[3].x + 1, self.points[3].y)
            newPoints[3] = __TS__New(Point, self.points[3].x, self.points[3].y)
            newPoints[4] = __TS__New(Point, self.points[3].x - 1, self.points[3].y)
            break
        end
    until true
    return newPoints
end
local TShape = __TS__Class()
TShape.name = "TShape"
__TS__ClassExtends(TShape, Shape)
function TShape.prototype.____constructor(self, cols)
    Shape.prototype.____constructor(self)
    self.fillColor = lcd.RGB(255, 0, 0)
    self.points = {}
    local x = cols / 2
    local y = -2
    local ____self_points_16 = self.points
    ____self_points_16[#____self_points_16 + 1] = __TS__New(Point, x - 1, y)
    local ____self_points_17 = self.points
    ____self_points_17[#____self_points_17 + 1] = __TS__New(Point, x, y)
    local ____self_points_18 = self.points
    ____self_points_18[#____self_points_18 + 1] = __TS__New(Point, x + 1, y)
    local ____self_points_19 = self.points
    ____self_points_19[#____self_points_19 + 1] = __TS__New(Point, x, y + 1)
end
function TShape.prototype.rotate(self, clockwise)
    self.rotation = (self.rotation + (clockwise and 1 or -1)) % 4
    local newPoints = {}
    repeat
        local ____switch27 = self.rotation
        local ____cond27 = ____switch27 == 0
        if ____cond27 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x - 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y + 1)
            break
        end
        ____cond27 = ____cond27 or ____switch27 == 1
        if ____cond27 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y - 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y + 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x - 1, self.points[2].y)
            break
        end
        ____cond27 = ____cond27 or ____switch27 == 2
        if ____cond27 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x - 1, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y - 1)
            break
        end
        ____cond27 = ____cond27 or ____switch27 == 3
        if ____cond27 then
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y + 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x, self.points[2].y - 1)
            newPoints[#newPoints + 1] = __TS__New(Point, self.points[2].x + 1, self.points[2].y)
            break
        end
    until true
    return newPoints
end
local Grid = __TS__Class()
Grid.name = "Grid"
function Grid.prototype.____constructor(self, rows, cols, backColor, w, h)
    local blockSize = 0
    blockSize = h / rows
    self.blockSize = blockSize
    self.backColor = backColor
    self.cols = cols
    self.rows = rows
    self.blockColor = {}
    do
        local r = 0
        while r < rows do
            local col = {}
            do
                local c = 0
                while c < cols do
                    col[#col + 1] = 0
                    c = c + 1
                end
            end
            local ____self_blockColor_20 = self.blockColor
            ____self_blockColor_20[#____self_blockColor_20 + 1] = col
            r = r + 1
        end
    end
    self.xOffset = w / 2 - blockSize * cols / 2
    self.yOffset = h / 2 - blockSize * rows / 2
end
function Grid.prototype.draw(self, shape)
    self:paintShape(shape, shape.fillColor)
end
function Grid.prototype.erase(self, shape)
    self:paintShape(shape, self.backColor)
end
function Grid.prototype.paintShape(self, shape, color)
    __TS__ArrayForEach(
        shape.points,
        function(____, p) return self:paintSquare(p.y, p.x, color) end
    )
end
function Grid.prototype.getPreferredSize(self)
    return __TS__New(Point, self.blockSize * self.cols, self.blockSize * self.rows)
end
function Grid.prototype.isPosValid(self, points)
    local valid = true
    do
        local i = 0
        while i < #points do
            if points[i + 1].x < 0 or points[i + 1].x >= self.cols or points[i + 1].y >= self.rows then
                valid = false
                break
            end
            if points[i + 1].y >= 0 then
                if self.blockColor[points[i + 1].y + 1][points[i + 1].x + 1] ~= self.backColor then
                    valid = false
                    break
                end
            end
            i = i + 1
        end
    end
    return valid
end
function Grid.prototype.addShape(self, shape)
    do
        local i = 0
        while i < #shape.points do
            if shape.points[i + 1].y < 0 then
                return false
            end
            self.blockColor[shape.points[i + 1].y + 1][shape.points[i + 1].x + 1] = shape.fillColor
            i = i + 1
        end
    end
    return true
end
function Grid.prototype.eraseGrid(self)
    local width = self.cols * self.blockSize
    local height = self.rows * self.blockSize
    lcd.drawFilledRectangle(
        self.xOffset,
        self.yOffset,
        width,
        height,
        self.backColor
    )
end
function Grid.prototype.clearGrid(self)
    do
        local row = 0
        while row < self.rows do
            do
                local col = 0
                while col < self.cols do
                    self.blockColor[row + 1][col + 1] = self.backColor
                    col = col + 1
                end
            end
            row = row + 1
        end
    end
end
function Grid.prototype.paintSquare(self, row, col, color)
    if row >= 0 then
        lcd.drawFilledRectangle(
            self.xOffset + col * self.blockSize,
            self.yOffset + row * self.blockSize,
            self.blockSize - 1,
            self.blockSize - 1,
            color
        )
    end
end
function Grid.prototype.drawGrid(self)
    do
        local row = 0
        while row < self.rows do
            do
                local col = 0
                while col < self.cols do
                    if self.blockColor[row + 1][col + 1] ~= self.backColor then
                        self:paintSquare(row, col, self.blockColor[row + 1][col + 1])
                    end
                    col = col + 1
                end
            end
            row = row + 1
        end
    end
end
function Grid.prototype.paint(self)
    self:eraseGrid()
    self:drawGrid()
end
function Grid.prototype.checkRows(self, lastShape)
    local rowMin = lastShape.points[1].y
    local rowMax = lastShape.points[1].y
    local rowComplete
    local rowsRemoved = 0
    do
        local i = 1
        while i < #lastShape.points do
            if lastShape.points[i + 1].y < rowMin then
                rowMin = lastShape.points[i + 1].y
            end
            if lastShape.points[i + 1].y > rowMax then
                rowMax = lastShape.points[i + 1].y
            end
            i = i + 1
        end
    end
    if rowMin < 0 then
        rowMin = 0
    end
    while rowMax >= rowMin do
        rowComplete = true
        do
            local col = 0
            while col < self.cols do
                if self.blockColor[rowMax + 1][col + 1] == self.backColor then
                    rowComplete = false
                    break
                end
                col = col + 1
            end
        end
        if rowComplete then
            rowsRemoved = rowsRemoved + 1
            do
                local r = rowMax
                while r >= 0 do
                    do
                        local col = 0
                        while col < self.cols do
                            if r > 0 then
                                self.blockColor[r + 1][col + 1] = self.blockColor[r][col + 1]
                            else
                                self.blockColor[r + 1][col + 1] = self.backColor
                            end
                            col = col + 1
                        end
                    end
                    r = r - 1
                end
            end
            rowMin = rowMin + 1
        else
            rowMax = rowMax - 1
        end
    end
    return rowsRemoved
end
local Message = __TS__Class()
Message.name = "Message"
function Message.prototype.____constructor(self, game)
    self.margin = 20
    self.game = game
end
function Message.prototype.setMessage(self, message)
    self.messageLabel = message
end
function Message.prototype.clearMessage(self)
    self.messageLabel = nil
end
function Message.prototype.draw(self)
    if self.messageLabel == nil then
        return
    end
    lcd.drawFilledRectangle(
        self.margin,
        self.margin,
        game.w - self.margin * 2,
        game.h - self.margin * 2,
        COLOR_THEME_SECONDARY1,
        1
    )
    lcd.drawRectangle(
        self.margin,
        self.margin,
        game.w - self.margin * 2,
        game.h - self.margin * 2,
        COLOR_THEME_PRIMARY1,
        2
    )
    lcd.drawText(
        game.w / 2,
        game.h / 2,
        self.messageLabel,
        bit32.bor(
            bit32.bor(
                bit32.bor(COLOR_THEME_PRIMARY1, CENTER),
                VCENTER
            ),
            DBLSIZE
        )
    )
end
local Game = __TS__Class()
Game.name = "Game"
function Game.prototype.____constructor(self, w, h)
    self.level = -1
    self.rowsCompleted = 0
    self.phase = Game.gameState.initial
    self.score = 0
    self.timerToken = 0
    self.w = w
    self.h = h
    self.message = __TS__New(Message, self)
    self.grid = __TS__New(
        Grid,
        16,
        10,
        lcd.RGB(128, 128, 128),
        w,
        h
    )
    self.speed = 1000
    self.message:setMessage("TETRIS\nPress SYS to start")
    self.timerToken = getTime()
end
function Game.prototype.draw(self)
    lcd.clear(COLOR_THEME_PRIMARY2)
    self.grid:paint()
    if self.phase == Game.gameState.playing then
        self.grid:draw(self.currentShape)
    end
    if self.scoreLabel ~= nil then
        lcd.drawText(
            10,
            10,
            "Score: " .. self.scoreLabel,
            bit32.bor(SMLSIZE, COLOR_THEME_PRIMARY1)
        )
    end
    if self.levelLabel ~= nil then
        lcd.drawText(
            10,
            23,
            "Level: " .. self.levelLabel,
            bit32.bor(SMLSIZE, COLOR_THEME_PRIMARY1)
        )
    end
    if self.rowsLabel ~= nil then
        lcd.drawText(
            10,
            36,
            "Rows: " .. self.rowsLabel,
            bit32.bor(SMLSIZE, COLOR_THEME_PRIMARY1)
        )
    end
    self.message:draw()
end
function Game.prototype.newGame(self)
    self.message:clearMessage()
    self.grid:clearGrid()
    self.currentShape = self:newShape()
    self.score = 0
    self.rowsCompleted = 0
    self.score = 0
    self.level = -1
    self.speed = 1000
    self.phase = Game.gameState.playing
    self:incrementLevel()
end
function Game.prototype.updateLabels(self)
    self.scoreLabel = tostring(self.score)
    self.rowsLabel = tostring(self.rowsCompleted)
    self.levelLabel = tostring(self.level)
end
function Game.prototype.gameTimer(self)
    if self.phase == Game.gameState.playing then
        local points = self.currentShape:drop()
        if self.grid:isPosValid(points) then
            self.currentShape:setPos(points)
        else
            self:shapeFinished()
        end
    end
end
function Game.prototype.keyHandler(self, event)
    local points
    if self.phase == Game.gameState.playing then
        repeat
            local ____switch88 = event
            local ____cond88 = ____switch88 == EVT_VIRTUAL_NEXT
            if ____cond88 then
                points = self.currentShape:moveRight()
                break
            end
            ____cond88 = ____cond88 or ____switch88 == EVT_VIRTUAL_PREV
            if ____cond88 then
                points = self.currentShape:moveLeft()
                break
            end
            ____cond88 = ____cond88 or ____switch88 == EVT_TELEM_FIRST
            if ____cond88 then
                points = self.currentShape:rotate(true)
                break
            end
            ____cond88 = ____cond88 or ____switch88 == EVT_VIRTUAL_NEXT_PAGE
            if ____cond88 then
                points = self.currentShape:drop()
                while self.grid:isPosValid(points) do
                    self.currentShape:setPos(points)
                    points = self.currentShape:drop()
                end
                self:shapeFinished()
                break
            end
        until true
        repeat
            local ____switch90 = event
            local ____cond90 = ____switch90 == EVT_VIRTUAL_NEXT or ____switch90 == EVT_VIRTUAL_PREV or ____switch90 == EVT_TELEM_FIRST
            if ____cond90 then
                if self.grid:isPosValid(points) then
                    self.currentShape:setPos(points)
                end
                break
            end
        until true
    end
    if event == EVT_SYS_BREAK then
        self:newGame()
    elseif event == EVT_MODEL_FIRST then
        self:togglePause()
    end
end
function Game.prototype.togglePause(self)
    if self.phase == Game.gameState.paused then
        self.message:clearMessage()
        self.phase = Game.gameState.playing
        self:draw()
    elseif self.phase == Game.gameState.playing then
        self.phase = Game.gameState.paused
        self:showMessage("PAUSED")
    end
end
function Game.prototype.showMessage(self, message)
    self.message:setMessage(message)
end
function Game.prototype.incrementLevel(self)
    self.level = self.level + 1
    if self.level < 10 then
        self.speed = 1000 - self.level * 100
    end
    self:updateLabels()
end
function Game.prototype.shapeFinished(self)
    if self.grid:addShape(self.currentShape) then
        self.grid:draw(self.currentShape)
        local completed = self.grid:checkRows(self.currentShape)
        self.rowsCompleted = self.rowsCompleted + completed
        self.score = self.score + completed * (self.level + 1) * 10
        if self.rowsCompleted > (self.level + 1) * 10 then
            self:incrementLevel()
        end
        self:updateLabels()
        self.currentShape = self:newShape()
    else
        self.phase = Game.gameState.gameOver
        self:showMessage("GAME OVER\nPress SYS to Restart")
    end
end
function Game.prototype.newShape(self)
    local randomShape = math.floor(math.random() * 7)
    local newShape
    repeat
        local ____switch105 = randomShape
        local ____cond105 = ____switch105 == 0
        if ____cond105 then
            newShape = __TS__New(LShape, false, self.grid.cols)
            break
        end
        ____cond105 = ____cond105 or ____switch105 == 1
        if ____cond105 then
            newShape = __TS__New(LShape, true, self.grid.cols)
            break
        end
        ____cond105 = ____cond105 or ____switch105 == 2
        if ____cond105 then
            newShape = __TS__New(TShape, self.grid.cols)
            break
        end
        ____cond105 = ____cond105 or ____switch105 == 3
        if ____cond105 then
            newShape = __TS__New(StepShape, false, self.grid.cols)
            break
        end
        ____cond105 = ____cond105 or ____switch105 == 4
        if ____cond105 then
            newShape = __TS__New(StepShape, true, self.grid.cols)
            break
        end
        ____cond105 = ____cond105 or ____switch105 == 5
        if ____cond105 then
            newShape = __TS__New(SquareShape, self.grid.cols)
            break
        end
        ____cond105 = ____cond105 or ____switch105 == 6
        if ____cond105 then
            newShape = __TS__New(StraightShape, self.grid.cols)
            break
        end
    until true
    return newShape
end
function Game.prototype.run(self, event, touchState)
    local t = getTime()
    if (t - self.timerToken) * 10 >= self.speed then
        self:gameTimer()
        self.timerToken = t
    end
    self:draw()
    self:keyHandler(event)
    return 0
end
Game.gameState = {initial = 0, playing = 1, paused = 2, gameOver = 3}
local function init(w, h)
    if w == nil then
        w = LCD_W
    end
    if h == nil then
        h = LCD_H
    end
    game = __TS__New(Game, w, h)
end
local function run(event, touchState)
    return game:run(event, touchState)
end
____exports.init = init
____exports.run = run
return ____exports
