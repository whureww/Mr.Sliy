/**
 * 技能基类
 * 所有智能体技能都继承自此类
 */

class Skill {
  constructor(name, description, version = '1.0.0') {
    this.name = name;
    this.description = description;
    this.version = version;
    this.enabled = true;
    this.dependencies = [];
  }

  async init() {
    return true;
  }

  async execute(context = {}) {
    throw new Error(`技能 ${this.name} 必须实现 execute 方法`);
  }

  canExecute(context = {}) {
    return this.enabled;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      enabled: this.enabled,
      dependencies: this.dependencies
    };
  }
}

module.exports = Skill;
