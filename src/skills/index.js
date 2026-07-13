/**
 * 技能管理器
 * 管理所有智能体技能的注册、加载和执行
 */

const { logger } = require('../utils/logger');
const Skill = require('./Skill');

class SkillManager {
  constructor() {
    this.skills = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    logger.info('正在初始化技能管理器...');

    const codeDetectionSkill = require('./code-detection');
    this.register(codeDetectionSkill);

    const codeOptimizationSkill = require('./code-optimization');
    this.register(codeOptimizationSkill);

    const codeAnalysisSkill = require('./code-analysis');
    this.register(codeAnalysisSkill);

    for (const skill of this.skills.values()) {
      if (typeof skill.init === 'function') {
        try {
          await skill.init();
          logger.debug(`技能初始化完成: ${skill.name}`);
        } catch (error) {
          logger.error(`技能初始化失败: ${skill.name}`, error);
        }
      }
    }

    this.initialized = true;
    logger.info(`技能管理器初始化完成，共加载 ${this.skills.size} 个技能`);
  }

  register(skill) {
    if (!(skill instanceof Skill)) {
      throw new Error('注册的技能必须是 Skill 类的实例');
    }

    if (this.skills.has(skill.name)) {
      logger.warn(`技能已存在，将被覆盖: ${skill.name}`);
    }

    this.skills.set(skill.name, skill);
    logger.debug(`注册技能: ${skill.name} v${skill.version}`);
    return true;
  }

  unregister(skillName) {
    if (this.skills.has(skillName)) {
      this.skills.delete(skillName);
      logger.debug(`注销技能: ${skillName}`);
      return true;
    }
    return false;
  }

  getSkill(skillName) {
    return this.skills.get(skillName) || null;
  }

  hasSkill(skillName) {
    return this.skills.has(skillName);
  }

  getAllSkills() {
    return Array.from(this.skills.values()).map(skill => skill.getInfo());
  }

  getEnabledSkills() {
    return Array.from(this.skills.values())
      .filter(skill => skill.enabled)
      .map(skill => skill.getInfo());
  }

  async executeSkill(skillName, context = {}) {
    const skill = this.skills.get(skillName);
    
    if (!skill) {
      throw new Error(`未找到技能: ${skillName}`);
    }

    if (!skill.enabled) {
      throw new Error(`技能已禁用: ${skillName}`);
    }

    if (!skill.canExecute(context)) {
      throw new Error(`技能 ${skillName} 无法在当前上下文执行`);
    }

    logger.debug(`执行技能: ${skillName}`);
    const startTime = Date.now();
    
    try {
      const result = await skill.execute(context);
      const duration = Date.now() - startTime;
      logger.debug(`技能执行完成: ${skillName} (${duration}ms)`);
      return {
        success: true,
        skill: skillName,
        result,
        durationMs: duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`技能执行失败: ${skillName}`, error);
      return {
        success: false,
        skill: skillName,
        error: error.message,
        durationMs: duration
      };
    }
  }

  enableSkill(skillName) {
    const skill = this.skills.get(skillName);
    if (skill) {
      skill.enabled = true;
      logger.info(`启用技能: ${skillName}`);
      return true;
    }
    return false;
  }

  disableSkill(skillName) {
    const skill = this.skills.get(skillName);
    if (skill) {
      skill.enabled = false;
      logger.info(`禁用技能: ${skillName}`);
      return true;
    }
    return false;
  }
}

const skillManager = new SkillManager();

module.exports = {
  SkillManager,
  skillManager,
  Skill
};
