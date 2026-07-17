<!-- 
模板ID: 3555
模板名称: 几何风-方块堆叠
适用场景: 立体几何风目录页
设计特点: 方块叠加,层次分明,空间感
-->
<div class="w-[1440px] h-[810px] bg-gradient-to-br from-slate-800 via-gray-900 to-slate-900 relative overflow-hidden">
  <!-- 方块装饰 -->
  <div class="absolute top-10 left-10 w-24 h-24 bg-cyan-500 opacity-20"></div>
  <div class="absolute top-20 left-20 w-24 h-24 bg-purple-500 opacity-20"></div>
  <div class="absolute bottom-20 right-10 w-32 h-32 bg-pink-500 opacity-20"></div>
  
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col justify-center relative z-10">
    <!-- 标题 -->
    <h2 class="text-4xl font-bold text-white mb-10 text-center">目录</h2>
    
    <!-- 章节列表 - 堆叠效果 -->
    <div class="grid grid-cols-2 gap-6">
      
      <div class="relative">
        <!-- 阴影层 -->
        <div class="absolute inset-0 bg-cyan-500 transform translate-x-2 translate-y-2"></div>
        <div class="absolute inset-0 bg-purple-500 transform translate-x-1 translate-y-1"></div>
        <!-- 主体 -->
        <div class="relative bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-2">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-cyan-600 to-purple-600 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0">
              1
            </div>
            <div class="text-lg text-gray-900 font-bold">项目背景</div>
          </div>
        </div>
      </div>
      
      <div class="relative">
        <!-- 阴影层 -->
        <div class="absolute inset-0 bg-cyan-500 transform translate-x-2 translate-y-2"></div>
        <div class="absolute inset-0 bg-purple-500 transform translate-x-1 translate-y-1"></div>
        <!-- 主体 -->
        <div class="relative bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-2">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-cyan-600 to-purple-600 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0">
              2
            </div>
            <div class="text-lg text-gray-900 font-bold">核心功能</div>
          </div>
        </div>
      </div>
      
      <div class="relative">
        <!-- 阴影层 -->
        <div class="absolute inset-0 bg-cyan-500 transform translate-x-2 translate-y-2"></div>
        <div class="absolute inset-0 bg-purple-500 transform translate-x-1 translate-y-1"></div>
        <!-- 主体 -->
        <div class="relative bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-2">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-cyan-600 to-purple-600 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0">
              3
            </div>
            <div class="text-lg text-gray-900 font-bold">技术架构</div>
          </div>
        </div>
      </div>
      
      <div class="relative">
        <!-- 阴影层 -->
        <div class="absolute inset-0 bg-cyan-500 transform translate-x-2 translate-y-2"></div>
        <div class="absolute inset-0 bg-purple-500 transform translate-x-1 translate-y-1"></div>
        <!-- 主体 -->
        <div class="relative bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-2">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-cyan-600 to-purple-600 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0">
              4
            </div>
            <div class="text-lg text-gray-900 font-bold">实施计划</div>
          </div>
        </div>
      </div>
      
    </div>
  </div>
</div>
