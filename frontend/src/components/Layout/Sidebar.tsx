import { 
  LayoutDashboard, 
  FolderOpen, 
  Search, 
  Bug, 
  Sparkles, 
  RefreshCw, 
  Settings,
  GitBranch,
  Wrench
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';

const menuItems = [
  { id: 'dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { id: 'projects', icon: FolderOpen, label: '项目管理' },
  { id: 'scan', icon: Search, label: '代码扫描' },
  { id: 'issues', icon: Bug, label: '代码缺陷' },
  { id: 'ai', icon: Sparkles, label: 'AI优化' },
  { id: 'updates', icon: GitBranch, label: '自更新' },
  { id: 'repairs', icon: Wrench, label: '自修复' },
  { id: 'settings', icon: Settings, label: '系统设置' },
];

export function Sidebar() {
  const { currentPage, setCurrentPage } = useAppStore();

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Mr.Sliy</h1>
            <p className="text-xs text-gray-400">代码优化智能体</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setCurrentPage(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      
      <div className="p-4 border-t border-gray-700">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-2">当前版本</p>
          <p className="text-sm font-semibold text-blue-400">v2.4.5</p>
        </div>
      </div>
    </aside>
  );
}