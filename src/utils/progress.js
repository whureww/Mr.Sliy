const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgRed: '\x1b[41m'
};

class ProgressBar {
  constructor(options = {}) {
    this.total = options.total || 100;
    this.current = options.current || 0;
    this.width = options.width || 50;
    this.description = options.description || '';
    this.status = options.status || '';
    this.startTime = Date.now();
    this.lastUpdateTime = 0;
    this.updateInterval = options.updateInterval || 50;
    this.showETA = options.showETA !== false;
    this.showPercent = options.showPercent !== false;
    this.showCount = options.showCount !== false;
    this.showStatus = options.showStatus !== false;
    this.color = options.color || 'green';
    this.stream = options.stream || process.stdout;
    this._lastRender = '';
    this._lastStatus = '';
    this._animationIndex = 0;
    this._animationChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this._animationTimer = null;
    this._isActive = false;
  }

  update(current, options = {}) {
    this.current = current;
    if (typeof options === 'string') {
      this.description = options;
    } else if (options) {
      if (options.description !== undefined) this.description = options.description;
      if (options.status !== undefined) this.status = options.status;
    }

    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }

    this.lastUpdateTime = now;
    this.render();
  }

  startAnimation() {
    if (this._animationTimer) return;
    this._isActive = true;
    this._animationTimer = setInterval(() => {
      if (this._isActive) {
        this.render();
      }
    }, 50);
  }

  stopAnimation() {
    this._isActive = false;
    if (this._animationTimer) {
      clearInterval(this._animationTimer);
      this._animationTimer = null;
    }
  }

  increment(amount = 1, options) {
    this.update(this.current + amount, options);
  }

  setTotal(total) {
    this.total = total;
    this.render();
  }

  setDescription(description) {
    this.description = description;
    this.render();
  }

  setStatus(status) {
    this.status = status;
    this.render();
  }

  render() {
    const percent = Math.min(100, Math.max(0, Math.round((this.current / this.total) * 100)));
    const filledWidth = Math.round((this.width * percent) / 100);
    const emptyWidth = this.width - filledWidth;

    const fillChar = '█';
    const emptyChar = '░';

    let bar = '';
    for (let i = 0; i < filledWidth; i++) {
      bar += fillChar;
    }
    for (let i = 0; i < emptyWidth; i++) {
      bar += emptyChar;
    }

    const elapsed = Date.now() - this.startTime;
    const eta = this.current > 0 ? Math.round((elapsed * (this.total - this.current)) / this.current) : 0;

    this._animationIndex = (this._animationIndex + 1) % this._animationChars.length;
    const animationChar = this._animationChars[this._animationIndex];

    let line = '\r';

    if (this.description) {
      const desc = this.description.length > 20 ? this.description.substring(0, 19) + '…' : this.description;
      line += colors.cyan + animationChar + ' ' + desc.padEnd(20) + colors.reset + ' ';
    }

    line += colors[this.color] + bar + colors.reset + ' ';

    if (this.showPercent) {
      line += colors.bright + percent.toString().padStart(3) + '%' + colors.reset + ' ';
    }

    if (this.showCount) {
      line += this.current + '/' + this.total + ' ';
    }

    if (this.showStatus && this.status) {
      const status = this.status.length > 25 ? this.status.substring(0, 24) + '…' : this.status;
      line += colors.dim + '[' + status + ']' + colors.reset + ' ';
    }

    if (this.showETA && eta > 0) {
      line += colors.dim + 'ETA: ' + formatTime(eta) + colors.reset;
    }

    const clearPad = Math.max(0, (this._lastRender.length || 0) - line.length);
    line += ' '.repeat(clearPad);

    this._lastRender = line;
    this.stream.write(line);
  }

  complete(description, status) {
    this.stopAnimation();
    this.current = this.total;
    if (description) this.description = description;
    if (status) this.status = status;
    this.render();
    this.stream.write('\n');
  }

  fail(description, error) {
    this.stopAnimation();
    this.description = description;
    if (error) this.status = error;
    this.color = 'red';
    this.render();
    this.stream.write('\n');
  }

  clear() {
    this.stopAnimation();
    this.stream.write('\r' + ' '.repeat(120) + '\r');
  }
}

class MultiStepProgress {
  constructor(steps = [], options = {}) {
    this.steps = steps;
    this.currentStep = 0;
    this.stepProgress = null;
    this.totalSteps = steps.length;
    this.stream = options.stream || process.stdout;
    this.width = options.width || 60;
  }

  async start() {
    this.printStepHeader();
    
    for (let i = 0; i < this.steps.length; i++) {
      this.currentStep = i;
      const step = this.steps[i];
      
      await this.executeStep(step);
    }
    
    this.stream.write('\n');
  }

  printStepHeader() {
    let header = `${colors.bright}┌${'─'.repeat(this.width)}┐${colors.reset}\n`;
    header += `${colors.bright}│${'代码优化进度'.padCenter(this.width)}│${colors.reset}\n`;
    header += `${colors.bright}└${'─'.repeat(this.width)}┘${colors.reset}\n`;
    this.stream.write(header);
  }

  async executeStep(step) {
    const stepNumber = this.currentStep + 1;
    const prefix = `${colors.blue}[${stepNumber}/${this.totalSteps}]${colors.reset}`;
    
    this.stream.write(`${prefix} ${colors.cyan}${step.name}${colors.reset}... `);
    
    if (step.total) {
      this.stepProgress = new ProgressBar({
        total: step.total,
        width: this.width - 30,
        showPercent: true,
        showCount: true,
        showETA: true,
        stream: this.stream
      });

      try {
        await step.task(this.stepProgress);
        this.stream.write(`${colors.green}✓${colors.reset}\n`);
      } catch (error) {
        this.stream.write(`${colors.red}✗${colors.reset}\n`);
        throw error;
      }
    } else {
      try {
        await step.task();
        this.stream.write(`${colors.green}✓${colors.reset}\n`);
      } catch (error) {
        this.stream.write(`${colors.red}✗${colors.reset}\n`);
        throw error;
      }
    }
  }

  updateSubProgress(current, description) {
    if (this.stepProgress) {
      this.stepProgress.update(current, description);
    }
  }

  complete() {
    const footer = `${colors.bright}┌${'─'.repeat(this.width)}┐${colors.reset}\n`;
    const successText = `${colors.green}优化完成！${colors.reset}`;
    this.stream.write(footer);
    this.stream.write(`${colors.bright}│${successText.padCenter(this.width)}│${colors.reset}\n`);
    this.stream.write(`${colors.bright}└${'─'.repeat(this.width)}┘${colors.reset}\n`);
  }
}

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

String.prototype.padCenter = function(width) {
  const len = this.length;
  if (len >= width) return this;
  const padding = width - len;
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return ' '.repeat(left) + this + ' '.repeat(right);
};

module.exports = {
  ProgressBar,
  MultiStepProgress,
  formatTime,
  colors
};