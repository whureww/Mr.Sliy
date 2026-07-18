import { Bell, HelpCircle, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import { healthApi } from '@/lib/api';

interface HealthStatus {
  success: boolean;
  data?: {
    status: string;
    mode: string;
  };
}

export function Header() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const result = await healthApi.check();
        setHealthStatus(result);
        setIsOnline(true);
      } catch {
        setIsOnline(false);
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (!isOnline) return 'bg-gray-500';
    if (healthStatus?.data?.status === 'healthy') return 'bg-green-500';
    return 'bg-yellow-500';
  };

  const getModeText = () => {
    if (!healthStatus?.data?.mode) return '未知';
    return healthStatus.data.mode === 'online' ? '在线模式' : '离线模式';
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${getStatusColor()} animate-pulse`}></span>
          <span className="text-sm text-gray-600">{getModeText()}</span>
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>
        
        <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
          <HelpCircle className="w-5 h-5" />
        </button>
        
        <div className="flex items-center gap-3 pl-6 border-l border-gray-200">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">管理员</p>
            <p className="text-xs text-gray-500">本地账户</p>
          </div>
        </div>
      </div>
    </header>
  );
}