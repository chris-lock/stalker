import phantom from 'phantom';
import request from 'request';
import zlib from 'zlib';

class Logger {
  static write(line, indent = 0, newLine = true) {
    process.stdout.write(
      `${Logger.lineBreak(newLine)}${Logger.indent(indent)}${line}`
    );
  }

  static lineBreak(newLine) {
    return (newLine) ? "\n" : '';
  }

  static indent(indent) {
    return '  '.repeat(indent);
  }

  static overwrite(line, indent = 0) {
    process.stdout.write("\r\x1b[K");
    Logger.write(line, indent, false);
  }
}

class SiteStalk {
  constructor(root, breakpoints, paths) {
    Logger.write(root);

    this.root = root;
    this.breakpoints = breakpoints;
    this.paths = [''].concat(paths);
    this.visitedPaths = [];

    this._loadNextPath();
  }

  addUrls(urls) {
    // urls.forEach(this._addSiteUrls.bind(this));
    // this.paths.sort();
    this._loadNextPath();
  }

  _loadNextPath() {
    var nextPath = this.paths.shift();

    if (nextPath  != undefined) {
      this.visitedPaths.push(nextPath);

      new PageStalk(
        this.root,
        `/${nextPath}`,
        this.breakpoints,
        this.addUrls.bind(this)
      );
    }
  }

  _addSiteUrls(url) {
    if (url.includes(this.root)) {
      let path = url.split(`${this.root}/`)[1];

      if (!this.paths.includes(path) && !this.visitedPaths.includes(path)) {
        this.paths.push(path);
      }
    }
  }
}

class PageStalk {
  instance;
  page;
  urlCallback;
  resourceCount = 0;
  waitForResourceTimeoutId;

  constructor(root, path, breakpoints, urlCallback) {
    var pageImageDir = (path == '/')
          ? 'home'
          : path;
    this.root = root;
    this.path = path;
    this.imageDir = `${root}/${pageImageDir}/`;
    this.breakpoints = breakpoints;
    this.urlCallback = urlCallback;

    phantom
      .create()
      .then(this.setInstance.bind(this))
      .then(this.openPage.bind(this))
      .catch(this.onError.bind(this));
  }

  setInstance(instance) {
    this.instance = instance;
    return instance.createPage();
  }

  openPage(page) {
    Logger.write(...this._logArgs('loading'));

    this.page = page;
    this.page.property('viewportSize', {
      height: 100,
      width: this.breakpoints[0],
    });
    this.page.on('onCallback', this.onCallback.bind(this));
    this.page.on('onLoadFinished', this.onLoadFinished.bind(this));
    this.page.on('onResourceRequested', this.onResourceRequested.bind(this));
    this.page.on('onResourceReceived', this.onResourceReceived.bind(this));
    return this.page.open(`https://${this.root}${this.path}`);
  }

  onLoadFinished() {
    this.page.evaluate(function() {
      function onWindowLoad() {
        var links = document.getElementsByTagName('a'),
            urls = {};

        for (let i = 0; i< links.length; i++){
          urls[links[i].href] = true;
        }

        window.callPhantom({
          method: 'addUrls',
          params: Object.keys(urls),
        });

        setTimeout(() => {
          window.callPhantom({
            method: 'onWindowLoad',
          });
        }, 500);
      }

      if (document.readyState == 'complete') {
        onWindowLoad();
      } else {
        window.addEventListener('load', onWindowLoad, false);
      }
    });
  }

  onCallback(call) {
    this[call.method](call.params);
  }

  addUrls(urls) {
    this.urlCallback(urls);
  }

  onWindowLoad() {
    this.windowLoaded = true;
    this._screenCaptureIfPageFinished();
  }

  onResourceRequested(request) {
    this.resourceCount++;
  }

  onResourceReceived(request) {
    if (!request.stage || request.stage === 'end') {
      this.resourceCount--;

      if (!this.resourceCount <= 1) {
        this.onResourceFinished();
      }
    }
  }

  onResourceFinished() {
    clearTimeout(this.waitForResourceTimeoutId);

    this.waitForResourceTimeoutId = setTimeout(() => {
      if (!this.resourceCount <= 1) {
        this.resourcesComplete = true;
        this._screenCaptureIfPageFinished();
      } else {
        this.onResourceFinished();
      }
    }, 1000);
  }

  close(page) {
    Logger.overwrite(...this._logArgs('complete'));
    this.page.close();
    this.instance.exit();
  }

  onError(error) {
    Logger.overwrite(...this._logArgs('failed'));
    Logger.write(error);

    !this.page || this.page.close();
    this.instance.exit();
  }

  _logArgs(message) {
    return [
      `├── ${this.root}${this.path} (${message})`,
      1
    ];
  }

  _screenCaptureIfPageFinished() {
    if (this.windowLoaded && this.resourcesComplete && !this.screenCaptureStared) {
      Logger.overwrite(...this._logArgs('ready'));

      this.screenCaptureStared = true;
      this._screenCaptureBreakpoint(0);
    }
  }

  _screenCaptureBreakpoint(index) {
    if (index >= this.breakpoints.length) {
      this.close();
    } else {
      let breakpoint = this.breakpoints[index];

      this.page.property('viewportSize', {
        height: 100,
        width: breakpoint,
      });

      this._screenCaptureIfBreakpointFinished(index, breakpoint);
    }
  }

  _screenCaptureIfBreakpointFinished(index, breakpoint) {
    setTimeout(() => {
      if (!this.resourceCount == 0) {
        this.page.render(`${this.imageDir}${index}-${breakpoint}.png`);
        this._screenCaptureBreakpoint(++index);
      } else {
        this._screenCaptureIfBreakpointFinished(index, breakpoint);
      }
    }, 1000);
  }
}

new SiteStalk('www.blueapron.com', [1280, 962, 768, 320], [
  'contact',
  'cookbook',
  'gifts',
  'recycling',
  'storage',
]);

// request({
//   url: 'https://www.blueapron.com/sitemap.xml.gz',
//   gzip: true,
// })
// .pipe(zlib.createGunzip()) // unzip
// .pipe(process.stdout);
