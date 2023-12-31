const fs = require('fs');
const CDP = require('chrome-remote-interface');
const { Page } = require('./page');
const puppeteer = require('puppeteer');

class Chrome {
    constructor() {
        // Browser settings
        this.chromePath = process.env['CHROME_APPLICATION_PATH'];
        this.userAgent =  process.env['DEFAULT_USER_AGENT'];
        this.debuggingPort = process.env['CHROME_REMOTE_DEBUGGING_PORT'];
        this.chromeInstanceOptions = [
            '--disable-gpu',
            '--headless',
            '--hide-scrollbars',
            '--new-window',
            '--no-sandbox',
            '--disable-audio',
            '--disable-breakpad',
            '--disable-audio-output',
            '--disable-extensions',
            '--remote-debugging-port=' + this.debuggingPort,
        ]

        this.browserInstance = undefined;
        this.clientConnected = false;
        this.pagesStatusCode = {};
    }

    setUserAgent(userAgent) {
        this.userAgent = userAgent;
    }

    deleteStatusCode(url) {
        try {
            delete this.pagesStatusCode[url];
        } catch(e) {
            console.log(e);
        }
    }

    async startBrowser() {
        if (!fs.existsSync(this.chromePath)) {
            console.log('unable to find Chrome install. Please specify with chromeLocation');
            process.exit(1);
        }

        if (!this.browserInstance) {
            this.browserInstance = await puppeteer.launch({
                headless: 'new',
                args: this.chromeInstanceOptions,
            });
        }
    }

    connectDevTools() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!this.clientConnected) {
                    console.log('unable to connect Chrome Devtools Protocol to browser');
                }
            }, 20 * 1000);

            const connect = () => {
                CDP.Version({ port: this.debuggingPort }).then((info) => {
                    clearTimeout(timeout);
                    this.webSocketDebuggerURL = info.webSocketDebuggerUrl || 'ws://localhost:' + this.debuggingPort + '/devtools/browser';
                    this.clientConnected = true;
                    resolve();

                }).catch((err) => {
                    console.log(err)
                    console.log('retrying connection to Chrome...');
                    return setTimeout(connect, 1000);
                });
            };

            setTimeout(connect, 500);
        });
    }

    async openNewTab({ targetUrl }) {
        try {
            const frameId = await this.connectToTab({ targetUrl });
            // Attach devtools to new create tab
            const page = new Page({
                frameId,
                userAgent: this.userAgent,
                targetUrl,
            });
            await page.connectToTab();
            await page.startEvents();
            await page.waitForPageToFullRender();
            await page.setPageContent();

            await page.closeConnection();

            return page;
        } catch (e) {
            console.log('error opening new tab: ', e);
        }

        return page;
    }

    async connectToTab({ targetUrl }) {
        try {
            const { id } = await CDP.New({ port: this.debuggingPort });
            const { Page, Network } = await CDP({ target: id });
            await Promise.all([Page.enable(), Network.enable()]);

            Network.responseReceived((request) => {
                const { type, response: { status, url } } = request;

                if (type === 'Document' && targetUrl === url) {
                    this.pagesStatusCode[targetUrl] = status;
                }
            });

            const { frameId } = await Page.navigate({ url: targetUrl });

            return frameId;
        } catch (e) {
            console.log(`Error connecting to tab: ${ e }`)
        }
    }
}

module.exports = { Chrome };
