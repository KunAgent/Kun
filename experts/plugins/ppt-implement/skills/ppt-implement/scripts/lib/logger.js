#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 日志目录（脚本所在目录的上级目录下的 logs 文件夹）
const SCRIPT_DIR = path.dirname(__dirname);
const LOGS_DIR = path.join(SCRIPT_DIR, 'logs');

const isPrintConsole = false;

/**
 * 创建日志器
 * @param {string} name - 日志器名称，用于生成日志文件名
 * @returns {object} - 日志器对象，包含 log, error, warn 方法
 */
function createLogger(name) {
    // 确保日志目录存在
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    // 日志文件路径
    const logFile = path.join(LOGS_DIR, `${name}.log`);

    /**
     * 获取当前时间戳
     */
    function getTimestamp() {
        const now = new Date();
        return now.toISOString().replace('T', ' ').substring(0, 19);
    }

    /**
     * 写入日志到文件
     */
    function writeToFile(level, ...args) {
        const timestamp = getTimestamp();
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        const logLine = `[${timestamp}] [${level}] ${message}\n`;

        try {
            fs.appendFileSync(logFile, logLine);
        } catch (e) {
            // 忽略文件写入错误
        }
    }

    return {
        /**
         * 普通日志
         */
        log(...args) {
            isPrintConsole && console.log(...args);
            writeToFile('INFO', ...args);
        },

        /**
         * 错误日志
         */
        error(...args) {
            console.error(...args);
            writeToFile('ERROR', ...args);
        },

        /**
         * 警告日志
         */
        warn(...args) {
            isPrintConsole && console.warn(...args);
            writeToFile('WARN', ...args);
        },

        /**
         * 调试日志（仅写入文件，不输出到控制台）
         */
        debug(...args) {
            writeToFile('DEBUG', ...args);
        },

        /**
         * 获取日志文件路径
         */
        getLogFile() {
            return logFile;
        },

        /**
         * 清空日志文件
         */
        clear() {
            try {
                fs.writeFileSync(logFile, '');
            } catch (e) {
                // 忽略错误
            }
        }
    };
}

module.exports = { createLogger, LOGS_DIR };
