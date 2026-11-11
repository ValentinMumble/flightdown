import {describe, expect, it} from 'vitest';
import {layoutZones, mainView, topbarZones, TOPBAR_SLOTS} from './layout';
import {readModel, registeredName, usedSwitches} from './card';

const ALL = {topbar: true, flightMode: true, sliders: true, trims: true, mirrored: false};

describe('the TX16S screen, as EdgeTX 2.12 lays it out', () => {
  it('leaves the main view what the top bar, sliders, trims and flight mode do not take', () => {
    expect(mainView(ALL)).toEqual({x: 42, y: 53, w: 396, h: 173});
    expect(mainView({...ALL, flightMode: false, sliders: false, trims: false})).toEqual({x: 0, y: 45, w: 480, h: 227});
  });

  it('puts the 2 + 1 zones where the M2 EVO has them: the right one first, then left top and bottom', () => {
    expect(layoutZones('Layout2P1', ALL)).toEqual([
      {x: 240, y: 53, w: 198, h: 173},
      {x: 42, y: 53, w: 198, h: 86},
      {x: 42, y: 139, w: 198, h: 86},
    ]);
  });

  it('mirrors a layout, and takes an unknown one as one full zone', () => {
    expect(layoutZones('Layout2P1', {...ALL, mirrored: true})[0].x).toBe(42);
    expect(layoutZones('Layout9x9', ALL)).toEqual([{x: 42, y: 53, w: 396, h: 173}]);
  });

  it('has six top bar slots right of the EdgeTX button, a wide widget spanning two', () => {
    expect(TOPBAR_SLOTS).toBe(6);
    expect(topbarZones()[0]).toEqual({x: 48, y: 3, w: 74, h: 39});
    expect(topbarZones([2])[1].x).toBe(48 + 2 * 76);
    expect(topbarZones([2])[0].w).toBe(150);
  });
});

describe('the card', () => {
  it('reads a model: its screens, top bar and sensors', () => {
    const model = readModel('model20', {
      header: {name: 'M2 EVO', bitmap: 'M2_EVO_o.png'},
      screenData: {
        0: {
          LayoutId: 'Layout2P1',
          layoutData: {
            zones: {
              1: {
                widgetName: 'ArmedModel',
                widgetData: {options: {0: {type: 'Source', value: {source: 'SA'}}}},
              },
            },
            options: {
              0: {type: 'Bool', value: {boolValue: 1}},
              1: {type: 'Bool', value: {boolValue: 1}},
              2: {type: 'Bool', value: {boolValue: 0}},
            },
          },
        },
      },
      topbarData: {
        zones: {3: {widgetName: 'BattAnalog', widgetData: {options: {0: {type: 'Color', value: {color: 0xf8f8f8}}}}}},
      },
      telemetrySensors: {0: {label: 'RSSI'}, 5: {label: 'VFAS'}},
    });
    expect(model.screens[0].layout).toBe('Layout2P1');
    expect(model.screens[0].options).toEqual({
      topbar: true,
      flightMode: true,
      sliders: false,
      trims: true,
      mirrored: false,
    });
    expect(model.screens[0].zones).toEqual([
      {index: 1, widget: 'ArmedModel', options: [{type: 'Source', value: 'SA'}]},
    ]);
    expect(model.topbar).toEqual([{index: 3, widget: 'BattAnalog', options: [{type: 'Color', value: 0xf8f8f8}]}]);
    expect(model.sensors[0]).toBe('RSSI');
    expect(model.sensors[5]).toBe('VFAS');
  });

  it('finds the switches a model uses anywhere, but not in its power-on checks', () => {
    expect(
      usedSwitches({
        switchWarning: {SA: {pos: 'down'}, SB: {pos: 'up'}},
        customFn: {0: {swtch: 'SF0', func: 'PLAY_TRACK'}, 1: {swtch: '!SA0'}},
        logicalSw: {0: {func: 'FUNC_VNEG', def: 'SE,0'}},
        mixData: {0: {srcRaw: 'SC', swtch: 'NONE'}},
        timers: {0: {swtch: 'TELEMETRY_STREAMING'}},
      }),
    ).toEqual(['SA', 'SC', 'SE', 'SF']);
  });

  it('reads the name a Lua widget registers, past a commented-out one and through a local', () => {
    const battAnalog = `local name = "BattCheck (Analog)"
-- return { name = "BattCheck (Analog)", options = _options }
return { name = "BattAnalog", options = _options, create = create }`;
    expect(registeredName(battAnalog)).toBe('BattAnalog');
    expect(registeredName('local app = "Timer2"\nreturn {name = app, create = create}')).toBe('Timer2');
    expect(registeredName('local name = "ArmedModel"\n____exports.name = name\nreturn ____exports')).toBe('ArmedModel');
  });
});
