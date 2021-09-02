'use strict';
const utils = require('@iobroker/adapter-core');
const net = require('net');

let sanext, adapter, pollAllowed = false, reconnectTimeOut = null, timeoutPoll = null, timeout = null, pollingInterval = null, iter = 0, cmd = [], addr;

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name:         'sanext',
        ready:        main,
        unload:       callback => {
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
    readEnergy: (response, cb) => {
        setStates('Energy', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    tempIn:     (response, cb) => {
        setStates('tempIn', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    tempOut:    (response, cb) => {
        setStates('tempOut', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    tempDiff:   (response, cb) => {
        setStates('tempDiff', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    power:      (response, cb) => {
        setStates('power', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    volume:     (response, cb) => {
        setStates('volume', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    rate:       (response, cb) => {
        setStates('rate', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    imp1:       (response, cb) => {
        setStates('imp1', response.readFloatLE(6), () => cb());
    },
    imp2:       (response, cb) => {
        setStates('imp2', response.readFloatLE(6), () => cb());
    },
    imp3:       (response, cb) => {
        setStates('imp3', response.readFloatLE(6), () => cb());
    },
    imp4:       (response, cb) => {
        setStates('imp4', response.readFloatLE(6), () => cb());
    },
    rateEn:     (response, cb) => {
        setStates('rateEn', +parseFloat(response.readFloatLE(6)).toFixed(4), () => cb());
    },
    timeWork:   (response, cb) => {
        setStates('timeWork', response.readFloatLE(6), () => cb());
    },
    sysTime:    (response, cb) => {
        const r = response;
        setStates('sysTime', cZero(r[7]) + '.' + cZero(r[8]) + (r[6] + 2000) + ' ' + cZero(r[9]) + ':' + cZero(r[10]) + ':' + cZero(r[11]), () => cb());
    }
};

const options = {
    read: [
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

function iteration(){
    iter++;
    if (iter > options.read.length - 1){
        iter = 0;
        adapter.log.debug('Все данные прочитали');
        timeoutPoll = setTimeout(() => {
            timeoutPoll = null;
            if (sanext){
                sanext._events.data = undefined;
            }
            poll();
        }, pollingInterval);
    } else {
        poll();
    }
}

function poll(){
    if (pollAllowed){
        const len = [10 + options.read[iter].cmd.length];
        cmd = [].concat(addr, options.read[iter].code, len, options.read[iter].cmd, [0x78, 0x78]);
        adapter.log.debug('------------------------------------------------------------------------------------------------------');
        adapter.log.debug('Отправляем запрос - ' + options.read[iter].desc);

        send(cmd, (response) => {
            if (response.length > 0){
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

function send(cmd, cb){
    timeout && clearTimeout(timeout);
    timeout = setTimeout(() => {
        timeout = null;
        adapter.log.error('No response');

        if (sanext){
            sanext._events.data = undefined;
        }

        pollAllowed = true;
        cb && cb('');
    }, 5000);

    sanext.once('data', (response) => {
        timeout && clearTimeout(timeout);
        adapter.log.debug('RESPONSE: [' + toHexString(response) + ']');
        cb && cb(response);
    });

    const b1 = (crc(cmd) >> 8) & 0xff;
    cmd[cmd.length] = crc(cmd) & 0xff;
    cmd[cmd.length] = b1;
    const buf = Buffer.from(cmd);
    adapter.log.debug('Send cmd - [' + toHexString(buf) + ']');
    sanext.write(buf);
}

function toHexString(byteArray){
    return Array.from(byteArray, byte =>
        byte.toString(16).padStart(2, '0')
    ).join(' ').toUpperCase();
}

function setStates(name, val, cb){
    adapter.getState(name, (err, state) => {
        if (!state){
            adapter.setState(name, {val: val, ack: true});
        } else if (state.val === val){
            adapter.log.debug('setState ' + name + ' { oldVal: ' + state.val + ' = newVal: ' + val + ' }');
        } else if (state.val !== val){
            adapter.setState(name, {val: val, ack: true});
            adapter.log.debug('setState ' + name + ' { oldVal: ' + state.val + ' != newVal: ' + val + ' }');
        }
        cb && cb();
    });
}

function main(){
    if (!adapter.systemConfig) return;
    adapter.subscribeStates('*');
    pollingInterval = adapter.config.pollingtime ? parseInt(adapter.config.pollingtime, 10) :5000;

    if (adapter.config.sn){
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

function connectTCP(){
    adapter.log.debug('Connect to ' + adapter.config.ip + ':' + adapter.config.port);
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

function reconnect(){
    pollAllowed = false;
    adapter.setState('info.connection', false, true);
    adapter.log.debug('Sanext reconnect after 10 seconds');

    reconnectTimeOut = setTimeout(() => {
        reconnectTimeOut = null;
        if (sanext){
            sanext._events.data = undefined;
        }
        connectTCP();
    }, 10000);
}

function cZero(s){
    return s < 10 ? '0' + s :s;
}

const crc = (buffer) => {
    let crc = 0xFFFF, odd;
    for (let i = 0; i < buffer.length; i++) {
        crc = crc ^ buffer[i];
        for (let j = 0; j < 8; j++) {
            odd = crc & 0x0001;
            crc = crc >> 1;
            if (odd){
                crc = crc ^ 0xA001;
            }
        }
    }
    return crc;
};

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}
