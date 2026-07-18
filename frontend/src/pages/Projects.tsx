import { useState, useEffect } from 'react';
import { FolderOpen, Plus, Search, Edit2, Trash2, ChevronRight } from 'lucide-react';
import { projectApi } from '@/lib/api';
import { Project } from '@/lib/api';

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    path: '',
    language: '',
  });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const result = await projectApi.list();
      setProjects(result.data || []);
    } catch (error) {
      console.error('加载项目失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProject.name || !newProject.path) return;
    
    try {
      await projectApi.create(newProject);
      setShowCreateModal(false);
      setNewProject({ name: '', description: '', path: '', language: '' });
      loadProjects();
    } catch (error) {
      console.error('创建项目失败:', error);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('确定要删除这个项目吗？')) return;
    
    try {
      await projectApi.delete(id);
      loadProjects();
    } catch (error) {
      console.error('删除项目失败:', error);
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">项目管理</h1>
          <p className="text-gray-500 mt-1">管理所有代码分析项目</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>创建项目</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="搜索项目名称或路径..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        
        <div className="divide-y divide-gray-100">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto"></div>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无项目</p>
              <p className="text-sm mt-1">点击上方按钮创建第一个项目</p>
            </div>
          ) : (
            filteredProjects.map((project) => (
              <div key={project.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <FolderOpen className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{project.name}</p>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-sm text-gray-500">{project.path}</span>
                        {project.language && (
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                            {project.language}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                      project.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {project.status}
                    </span>
                    <button className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDeleteProject(project.id)}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </div>
                </div>
                {project.description && (
                  <p className="text-sm text-gray-500 mt-2 ml-13">{project.description}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max