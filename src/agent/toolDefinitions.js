/**
 * 工具定义表（从 agent.js 解耦提取）
 * 纯数据：描述每个工具的名称、用途与参数 schema，无运行时依赖。
 * 工具白名单的权威来源在 src/utils/securityGuard.js 的 TOOL_WHITELIST。
 */

function getToolDefinitions() {
  return {
    analyze_file: {
      name: 'analyze_file',
      description: '分析单个文件的代码缺陷和问题',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '要分析的文件路径'
          }
        },
        required: ['filePath']
      }
    },
    scan_project: {
      name: 'scan_project',
      description: '扫描整个项目目录，检测代码问题',
      parameters: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: '项目目录路径'
          },
          maxFiles: {
            type: 'number',
            description: '最大扫描文件数，默认100'
          }
        },
        required: ['projectPath']
      }
    },
    optimize_code: {
      name: 'optimize_code',
      description: '优化给定的代码片段，提供优化后的代码和说明',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要优化的代码'
          },
          language: {
            type: 'string',
            description: '代码语言，如javascript、python、java等'
          }
        },
        required: ['code']
      }
    },
    search_knowledge: {
      name: 'search_knowledge',
      description: '搜索知识库中的相关知识和最佳实践',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词'
          },
          limit: {
            type: 'number',
            description: '返回结果数量，默认10'
          }
        },
        required: ['query']
      }
    },
    get_status: {
      name: 'get_status',
      description: '获取智能体当前状态和配置信息',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    get_providers: {
      name: 'get_providers',
      description: '获取所有可用的LLM提供商列表',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    switch_provider: {
      name: 'switch_provider',
      description: '切换当前使用的LLM提供商',
      parameters: {
        type: 'object',
        properties: {
          providerName: {
            type: 'string',
            description: '提供商名称，如deepseek、zhipu、openai等'
          }
        },
        required: ['providerName']
      }
    },
    clear_history: {
      name: 'clear_history',
      description: '清空聊天历史记录',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    get_skills: {
      name: 'get_skills',
      description: '获取所有可用的技能列表',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    fix_file: {
      name: 'fix_file',
      description: '分析文件问题并自动修复，将优化后的代码直接写入文件',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '要修复的文件路径'
          },
          createBackup: {
            type: 'boolean',
            description: '是否创建备份文件，默认true'
          }
        },
        required: ['filePath']
      }
    },
    apply_fix: {
      name: 'apply_fix',
      description: '将优化后的代码应用到指定文件，直接替换原内容',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件路径'
          },
          optimizedCode: {
            type: 'string',
            description: '优化后的完整代码内容'
          },
          createBackup: {
            type: 'boolean',
            description: '是否创建备份，默认true'
          }
        },
        required: ['filePath', 'optimizedCode']
      }
    },
    self_update: {
      name: 'self_update',
      description: '执行智能体自更新，支持代码、配置、知识库等更新类型',
      parameters: {
        type: 'object',
        properties: {
          updateType: {
            type: 'string',
            description: '更新类型: code, config, knowledge, dependency'
          },
          content: {
            type: 'object',
            description: '更新内容'
          },
          description: {
            type: 'string',
            description: '更新描述'
          },
          autoConfirm: {
            type: 'boolean',
            description: '是否自动确认，默认false'
          }
        },
        required: ['updateType', 'content']
      }
    },
    update_from_ai: {
      name: 'update_from_ai',
      description: '通过AI建议执行智能体自更新，将自然语言想法转换为具体更新',
      parameters: {
        type: 'object',
        properties: {
          suggestion: {
            type: 'string',
            description: '用户的更新建议或想法'
          },
          autoConfirm: {
            type: 'boolean',
            description: '是否自动确认，默认false'
          }
        },
        required: ['suggestion']
      }
    },
    list_updates: {
      name: 'list_updates',
      description: '获取更新历史记录',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: '按状态过滤: pending, applied, failed, rolled_back'
          },
          limit: {
            type: 'number',
            description: '返回数量限制，默认20'
          }
        }
      }
    },
    list_bootstrap_history: {
      name: 'list_bootstrap_history',
      description: '获取更新和修复的合并历史记录',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: '类型过滤: update, repair, 为空则显示全部'
          },
          status: {
            type: 'string',
            description: '按状态过滤: pending, applied, failed, rolled_back, success'
          },
          limit: {
            type: 'number',
            description: '返回数量限制，默认20'
          }
        }
      }
    },
    rollback_update: {
      name: 'rollback_update',
      description: '回滚指定的更新',
      parameters: {
        type: 'object',
        properties: {
          updateId: {
            type: 'string',
            description: '要回滚的更新ID'
          }
        },
        required: ['updateId']
      }
    },
    self_repair: {
      name: 'self_repair',
      description: '执行智能体自修复，自动检测并修复运行时错误',
      parameters: {
        type: 'object',
        properties: {
          errorType: {
            type: 'string',
            description: '错误类型: database, network, file_system, dependency, configuration, runtime'
          },
          errorMessage: {
            type: 'string',
            description: '错误信息'
          },
          autoConfirm: {
            type: 'boolean',
            description: '是否自动确认，默认false'
          }
        },
        required: ['errorType', 'errorMessage']
      }
    },
    repair_from_ai: {
      name: 'repair_from_ai',
      description: '通过AI分析并修复错误',
      parameters: {
        type: 'object',
        properties: {
          errorMessage: {
            type: 'string',
            description: '错误信息'
          },
          errorStack: {
            type: 'string',
            description: '错误堆栈'
          },
          autoConfirm: {
            type: 'boolean',
            description: '是否自动确认，默认false'
          }
        },
        required: ['errorMessage']
      }
    },
    list_repairs: {
      name: 'list_repairs',
      description: '获取修复历史记录',
      parameters: {
        type: 'object',
        properties: {
          errorType: {
            type: 'string',
            description: '按错误类型过滤'
          },
          status: {
            type: 'string',
            description: '按状态过滤: pending, success, failed, rolled_back'
          },
          limit: {
            type: 'number',
            description: '返回数量限制，默认20'
          }
        }
      }
    },
    create_backup: {
      name: 'create_backup',
      description: '创建系统备份',
      parameters: {
        type: 'object',
        properties: {
          backupType: {
            type: 'string',
            description: '备份类型: update, repair, database, code, config, system'
          },
          description: {
            type: 'string',
            description: '备份描述'
          }
        },
        required: ['backupType']
      }
    },
    list_backups: {
      name: 'list_backups',
      description: '获取备份列表',
      parameters: {
        type: 'object',
        properties: {
          backupType: {
            type: 'string',
            description: '按备份类型过滤'
          },
          limit: {
            type: 'number',
            description: '返回数量限制，默认20'
          }
        }
      }
    },
    sandbox_status: {
      name: 'sandbox_status',
      description: '获取沙箱架构状态和所有服务的运行情况',
      parameters: {
        type: 'object',
        properties: {
          serviceName: {
            type: 'string',
            description: '可选，指定查看单个服务的状态'
          }
        }
      }
    },
    sandbox_enable: {
      name: 'sandbox_enable',
      description: '启用沙箱架构，将功能模块隔离到独立线程中运行',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    sandbox_disable: {
      name: 'sandbox_disable',
      description: '禁用沙箱架构，切换回传统单线程模式',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    sandbox_reload_service: {
      name: 'sandbox_reload_service',
      description: '热替换指定服务，支持不中断运行的情况下更新服务代码',
      parameters: {
        type: 'object',
        properties: {
          serviceName: {
            type: 'string',
            description: '服务名称: parser, detector, optimizer, knowledge, llm'
          },
          newVersion: {
            type: 'string',
            description: '新版本号'
          }
        },
        required: ['serviceName']
      }
    }
  };
}

module.exports = { getToolDefinitions };
