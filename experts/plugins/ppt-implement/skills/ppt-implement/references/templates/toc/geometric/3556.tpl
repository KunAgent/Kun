<!-- 
模板ID: 3556
模板名称: 几何风-波浪线条
适用场景: 流动几何风目录页
设计特点: 曲线美感,流畅动态,韵律感
-->
<div class="w-[1440px] h-[810px] bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 relative overflow-hidden">
  <!-- 波浪装饰 -->
  <svg class="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 1000 1000">
    <path d="M0,300 Q250,200 500,300 T1000,300" stroke="url(#grad1)" stroke-width="8" fill="none"/>
    <path d="M0,600 Q250,700 500,600 T1000,600" stroke="url(#grad2)" stroke-width="8" fill="none"/>
    <defs>
      <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:rgb(59,130,246);stop-opacity:1" />
        <stop offset="100%" style="stop-color:rgb(168,85,247);stop-opacity:1" />
      </linearGradient>
      <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:rgb(168,85,247);stop-opacity:1" />
        <stop offset="100%" style="stop-color:rgb(236,72,153);stop-opacity:1" />
      </linearGradient>
    </defs>
  </svg>
  
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col justify-center relative z-10">
    <!-- 标题 -->
    <h2 class="text-4xl font-bold text-purple-900 mb-10 text-center">目录</h2>
    
    <!-- 章节列表 -->
    <div class="space-y-5">
      
      <div class="bg-white p-5 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 border-4 border-purple-200 hover:border-purple-400">
        <div class="flex items-center gap-6">
          <div class="w-16 h-16 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 text-white rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg">
            1
          </div>
          <div class="text-xl text-gray-800 font-bold">项目背景</div>
        </div>
      </div>
      
      <div class="bg-white p-5 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 border-4 border-purple-200 hover:border-purple-400">
        <div class="flex items-center gap-6">
          <div class="w-16 h-16 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 text-white rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg">
            2
          </div>
          <div class="text-xl text-gray-800 font-bold">核心功能</div>
        </div>
      </div>
      
      <div class="bg-white p-5 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 border-4 border-purple-200 hover:border-purple-400">
        <div class="flex items-center gap-6">
          <div class="w-16 h-16 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 text-white rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg">
            3
          </div>
          <div class="text-xl text-gray-800 font-bold">技术架构</div>
        </div>
      </div>
      
      <div class="bg-white p-5 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 border-4 border-purple-200 hover:border-purple-400">
        <div class="flex items-center gap-6">
          <div class="w-16 h-16 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 text-white rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg">
            4
          </div>
          <div class="text-xl text-gray-800 font-bold">实施计划</div>
        </div>
      </div>
      
    </div>
  </div>
</div>
