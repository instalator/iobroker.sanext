'use strict';
const utils = require('@iobroker/adapter-core');
const net = require('net');

let sanext, adapter, pollAllowed = false, reconnectTimeOut = null, timeoutPoll = null, timeout = null,
    pollingInterval = null, iter = 0, cmd = [], addr;
let mbus = false;
const zeroConcat = (h) => {
    return parseInt(h.toString(16)) < 10 ? ('0' + h.toString(16)) : h.toString(16);
};

function startAdapter(options) {
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name: 'sanext',
        ready: main,
        unload: callback => {
            timeoutPoll && clearTimeout(timeoutPoll);
            reconnectTimeOut && clearTimeout(reconnectTimeOut);
            timeout && clearTimeout(timeout);
            try {
                sanext && sanext.destroy();
                adapter.log.debug('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        }
    }));
}

const func = {
    readMbus: (response, cb) => { // SANEXT MONO CU / BAUD 2400-8-1-EVEN
        mbus = true;
        const address = zeroConcat(response[7]) + zeroConcat(response[6]) + zeroConcat(response[5]) + zeroConcat(response[4]);
        const code = zeroConcat(response[8]); //DN15-00; DN20-01; DN25-02; DN32-03; DN40-04;
        const CurrentCoolingCapacity = parseInt(zeroConcat(response[19]) + zeroConcat(response[18]) + zeroConcat(response[17]) + zeroConcat(response[16])) * 0.01;
        const CurrentCalories = parseInt(zeroConcat(response[24]) + zeroConcat(response[23]) + zeroConcat(response[22]) + zeroConcat(response[21])) * 0.01;
        const Power = parseInt(zeroConcat(response[29]) + zeroConcat(response[28]) + zeroConcat(response[27]) + zeroConcat(response[26])) * 0.01;
        const InstantaneousFlowRate = parseInt(zeroConcat(response[34]) + zeroConcat(response[33]) + zeroConcat(response[32]) + zeroConcat(response[31])) * 0.01;
        const Volume = parseInt(zeroConcat(response[39]) + zeroConcat(response[38]) + zeroConcat(response[37]) + zeroConcat(response[36])) * 0.01;
        const WaterSupplyTemperature = parseInt(zeroConcat(response[43]) + zeroConcat(response[42]) + zeroConcat(response[41])) * 0.01;
        const BackwaterTemperature = parseInt(zeroConcat(response[46]) + zeroConcat(response[45]) + zeroConcat(response[44])) * 0.01;
        const WorkingTimeHour = parseInt(zeroConcat(response[49]) + zeroConcat(response[48]) + zeroConcat(response[47]));
        const CurrentTime = zeroConcat(response[53]) + '.' + zeroConcat(response[54]) + '.' + zeroConcat(response[56]) + zeroConcat(response[55]) + ' ' + zeroConcat(response[52]) + ':' + zeroConcat(response[51]) + ':' + zeroConcat(response[50]);//50-56

        adapter.log.debug('address - ' + address);
        adapter.log.debug('code - ' + code);
        adapter.log.debug('CurrentCoolingCapacity - ' + CurrentCoolingCapacity + ' kWH');
        adapter.log.debug('CurrentCalories - ' + CurrentCalories + ' kWH'); //0x05,0x01,0x00,0x00 (mean 000001.05kWH)
        adapter.log.debug('Power - ' + Power + ' kW'); //0x05,0x01,0x00,0x00 (mean 000001.05kWH)
        adapter.log.debug('InstantaneousFlowRate - ' + InstantaneousFlowRate + ' m3/h'); //0x05,0x01,0x00,0x00 (mean 000001.05kWH)
        adapter.log.debug('Volume - ' + Volume + ' m3'); //0x05,0x01,0x00,0x00 (mean 000001.05kWH)
        adapter.log.debug('WaterSupplyTemperature - ' + WaterSupplyTemperature + ' ℃'); //0x31,0x25,0x00 (0025.31℃)
        adapter.log.debug('BackwaterTemperature - ' + BackwaterTemperature + ' ℃'); //0x74,0x26,0x00 (0026.74℃)
        adapter.log.debug('WorkingTimeHour - ' + WorkingTimeHour + ' h'); //0x76,0x68,0x01 (016876h)
        adapter.log.debug('CurrentTime - ' + CurrentTime); //0x32,0x34,0x08,0x16,0x05,0x19,0x20 (2019.5.16-8:34:32)

        setStates('Energy', CurrentCalories);
        setStates('tempIn', WaterSupplyTemperature);
        setStates('tempOut', BackwaterTemperature);
        setStates('tempDiff', WaterSupplyTemperature - BackwaterTemperature);
        setStates('power', Power);
        setStates('volume', Volume);
        setStates('rate', 0);
        setStates('imp1', 0);
        setStates('imp2', 0);
        setStates('imp3', 0);
        setStates('imp4', 0);
        setStates('rateEn', 0);
        setStates('timeWork', WorkingTimeHour);
        setStates('sysTime', CurrentTime, () => cb());

//FE FE 68 20 13 47 06 12 00 74 00 81 2E 1F 90 00 00 00 00 00 05 00 00 00 00 05 00 00 00 00 17 00 00 00 00 35 00 00 00 00 2C 02 23 00 11 23 00 34 58 00 09 49 12 05 09 23 20 00 08 F0 16
        /*
        0-1     Fixed code (2 bytes):0xFE,0xFE
        2       Frame start character:0x68
        3       Type of meter： 0x20
        4-10    Address(seven byte): 0x04,0x00,0x70,0x11,0x01,0x74,0x00 (address of the meter)
        11      Control code:0x81
        12      Date length:0x2E
        13-14   Date identification:0x1F,0x90
        15      SER:0x00
        16-19   Current cooling capacity:0x00,0x00,0x00,0x00 (mean 0kWH)
        20      Unit:0x05 （ 0.01kWH）
        21-24   Current calories:0x05,0x01,0x00,0x00 (mean 000001.05kWH)
        25      Unit:0x05 （ 0.01kWH）
        26-29   Power:0x00,0x00,0x00,0x00 (mean 0kW)
        30      Unit::0x17 （ 0.01kW）
        31-34   Instantaneous flow rate:0x00,0x00,0x00,0x00（ mean 0m3/h）
        35      Unit:0x35 （ 0.01m3/h）
        36-39   Volume: 0x00,0x00,0x00,0x00（mean 0m3）
        40      Unit:0x2C （ 0.01m3）
        41-43   Water supply temperature:0x31,0x25,0x00 (0025.31℃)
        44-46   Backwater temperature:0x74,0x26,0x00 (0026.74℃)
        47-49   Working time(hour):0x76,0x68,0x01 (016876h)
        50-56   Current time(YYYYMMDDHHMMSS): 0x32,0x34,0x08,0x16,0x05,0x19,0x20 (2019.5.16-8:34:32)
        57-58   State(refer to CJ-T188-2004 stand 8.3.2):ST1,ST2
        59      Check byte:FB
        60      Terminator:0x16
         */
    },
    readEnergy: (response, cb) => {
        setStates('Energy', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    tempIn: (response, cb) => {
        setStates('tempIn', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    tempOut: (response, cb) => {
        setStates('tempOut', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    tempDiff: (response, cb) => {
        setStates('tempDiff', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    power: (response, cb) => {
        setStates('power', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    volume: (response, cb) => {
        setStates('volume', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    rate: (response, cb) => {
        setStates('rate', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    imp1: (response, cb) => {
        setStates('imp1', response.readFloatLE(6), () => cb());
    },
    imp2: (response, cb) => {
        setStates('imp2', response.readFloatLE(6), () => cb());
    },
    imp3: (response, cb) => {
        setStates('imp3', response.readFloatLE(6), () => cb());
    },
    imp4: (response, cb) => {
        setStates('imp4', response.readFloatLE(6), () => cb());
    },
    rateEn: (response, cb) => {
        setStates('rateEn', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    timeWork: (response, cb) => {
        setStates('timeWork', response.readFloatLE(6), () => cb());
    },
    sysTime: (response, cb) => {
        const r = response;
        setStates('sysTime', cZero(r[7]) + '.' + cZero(r[8]) + (r[6] + 2000) + ' ' + cZero(r[9]) + ':' + cZero(r[10]) + ':' + cZero(r[11]), () => cb());
    }
};

const options = {
    read: [
        {
            code: 0xFF,
            cmd: [0xFE, 0xFE, 0x68, 0x20, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0x01, 0x03, 0x1F, 0x90, 0x00, 0xE1, 0x16],
            desc: 'Чтение MBUS',
            func: func.readMbus
        },
        {code: 0x01, cmd: [0x40, 0x00, 0x00, 0x00], desc: 'Чтение энергии', func: func.readEnergy},
        {code: 0x01, cmd: [0x04, 0x00, 0x00, 0x00], desc: 'Чтение температуры подачи', func: func.tempIn},
        {code: 0x01, cmd: [0x08, 0x00, 0x00, 0x00], desc: 'Чтение температуры обратки', func: func.tempOut},
        {code: 0x01, cmd: [0x10, 0x00, 0x00, 0x00], desc: 'Чтение разницы температур', func: func.tempDiff},
        {code: 0x01, cmd: [0x20, 0x00, 0x00, 0x00], desc: 'Чтение мощности', func: func.power},
        {code: 0x01, cmd: [0x80, 0x00, 0x00, 0x00], desc: 'Чтение объема', func: func.volume},
        {code: 0x01, cmd: [0x00, 0x01, 0x00, 0x00], desc: 'Чтение расхода', func: func.rate},
        {code: 0x01, cmd: [0x00, 0x02, 0x00, 0x00], desc: 'Чтение импульсный вход 1', func: func.imp1},
        {code: 0x01, cmd: [0x00, 0x04, 0x00, 0x00], desc: 'Чтение импульсный вход 2', func: func.imp2},
        {code: 0x01, cmd: [0x00, 0x08, 0x00, 0x00], desc: 'Чтение импульсный вход 3', func: func.imp3},
        {code: 0x01, cmd: [0x00, 0x10, 0x00, 0x00], desc: 'Чтение импульсный вход 4', func: func.imp4},
        {code: 0x01, cmd: [0x00, 0x20, 0x00, 0x00], desc: 'Чтение расход (по энергии)', func: func.rateEn},
        {code: 0x01, cmd: [0x00, 0x00, 0x08, 0x00], desc: 'Чтение Время нормальной работы', func: func.timeWork},
        {code: 0x04, cmd: [], desc: 'Чтение системного времени прибора', func: func.sysTime}
    ]
};

function iteration() {
    iter++;
    if (mbus) {
        iter = 9999;
    }
    if (iter > options.read.length - 1) {
        iter = 0;
        adapter.log.debug('Все данные прочитали');
        timeoutPoll = setTimeout(() => {
            timeoutPoll = null;
            if (sanext) {
                sanext._events.data = undefined;
            }
            poll();
        }, pollingInterval);
    } else {
        poll();
    }
}

function poll() {
    if (pollAllowed) {
        const len = [10 + options.read[iter].cmd.length];
        if (!mbus && options.read[iter].code !== 0xFF) {
            cmd = [].concat(addr, options.read[iter].code, len, options.read[iter].cmd, [0x78, 0x78]);
        } else {
            cmd = [].concat(options.read[iter].cmd);
        }
        adapter.log.debug('------------------------------------------------------------------------------------------------------');
        adapter.log.debug('Отправляем запрос - ' + options.read[iter].desc);

        send(cmd, (response) => {
            if (response.length > 0) {
                const fn = options.read[iter].func;
                adapter.log.debug('Ответ получен, парсим: ' + fn.name + ' - ' + ' response: ' + JSON.stringify(response) + ' length: ' + response.length);
                fn(response, () => iteration());
            } else {
                adapter.log.debug('Нет ответа на команду, читаем следующую.');
                iteration();
            }
        });
    }
}

function send(cmd, cb) {
    timeout && clearTimeout(timeout);
    timeout = setTimeout(() => {
        timeout = null;
        adapter.log.error('No response');
		adapter.log.error('sanext - ' + JSON.stringify(sanext));
        if (sanext) {
            sanext._events.data = undefined;
        }
		reconnect();
        pollAllowed = true;
        cb && cb('');
    }, 5000);

    sanext.once('data', (response) => {
        timeout && clearTimeout(timeout);
        adapter.log.debug('RESPONSE: [' + toHexString(response) + ']');
        cb && cb(response);
    });

    if (!mbus && options.read[iter].code !== 0xFF) {
        const b1 = (crc(cmd) >> 8) & 0xff;
        cmd[cmd.length] = crc(cmd) & 0xff;
        cmd[cmd.length] = b1;
    }
    const buf = Buffer.from(cmd);
    adapter.log.debug('Send cmd - [' + toHexString(buf) + ']');
    sanext.write(buf);
}

function toHexString(byteArray) {
    return Array.from(byteArray, byte =>
        byte.toString(16).padStart(2, '0')
    ).join(' ').toUpperCase();
}

function setStates(name, val, cb) {
    adapter.getState(name, (err, state) => {
        if (!state) {
            adapter.setState(name, {val: val, ack: true});
        } else if (state.val === val) {
            adapter.log.debug('setState ' + name + ' { oldVal: ' + state.val + ' = newVal: ' + val + ' }');
        } else if (state.val !== val) {
            adapter.setState(name, {val: val, ack: true});
            adapter.log.debug('setState ' + name + ' { oldVal: ' + state.val + ' != newVal: ' + val + ' }');
        }
        cb && cb();
    });
}

function main() {
    if (!adapter.systemConfig) return;
    adapter.subscribeStates('*');
    pollingInterval = adapter.config.pollingtime ? parseInt(adapter.config.pollingtime, 10) : 5000;

    if (adapter.config.sn) {
        addr = addrToArray(adapter.config.sn);
        connectTCP();
    } else {
        adapter.log.error('Configured Serial Number Error');
    }
}

const addrToArray = (addrSt) => {
    const _addr = Buffer.allocUnsafe(4);
    _addr.writeUInt32BE(parseInt(addrSt, 16), 0);
    return Array.prototype.slice.call(_addr, 0);
};

function connectTCP() {
    adapter.log.info('Connect to ' + adapter.config.ip + ':' + adapter.config.port);
    sanext && sanext.destroy();
    sanext = new net.Socket();
    sanext.connect({host: adapter.config.ip, port: adapter.config.port}, () => {
        adapter.log.info('Connected to server ' + adapter.config.ip + ':' + adapter.config.port);
        adapter.setState('info.connection', true, true);
        pollAllowed = true;
        poll();
    });
    sanext.on('close', (e) => {
        adapter.log.debug('closed ' + JSON.stringify(e));
        //reconnect();
    });
    sanext.on('error', (e) => {
        adapter.log.error('sanext ERROR: ' + JSON.stringify(e));
        if (!e.code || e.code === 'EISCONN' || e.code === 'EPIPE' || e.code === 'EALREADY' || e.code === 'EINVAL' || e.code === 'ECONNRESET' || e.code === 'ENOTFOUND') reconnect();
    });
    sanext.on('end', () => {
        adapter.log.debug('Disconnected from server');
        reconnect();
    });
}

function reconnect() {
    pollAllowed = false;
    adapter.setState('info.connection', false, true);
    adapter.log.debug('Sanext reconnect after 10 seconds');

    reconnectTimeOut = setTimeout(() => {
        reconnectTimeOut = null;
        if (sanext) {
            sanext._events.data = undefined;
        }
        connectTCP();
    }, 10000);
}

function cZero(s) {
    return s < 10 ? '0' + s : s;
}

const crc = (buffer) => {
    let crc = 0xFFFF, odd;
    for (let i = 0; i < buffer.length; i++) {
        crc = crc ^ buffer[i];
        for (let j = 0; j < 8; j++) {
            odd = crc & 0x0001;
            crc = crc >> 1;
            if (odd) {
                crc = crc ^ 0xA001;
            }
        }
    }
    return crc;
};

if (module.parent) {
    module.exports = startAdapter;
} else {
    startAdapter();
}
