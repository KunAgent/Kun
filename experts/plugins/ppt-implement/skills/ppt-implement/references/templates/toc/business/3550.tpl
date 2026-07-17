<!-- 
模板ID: 3550
模板名称: 商务风-进度条式
适用场景: 流程化商务目录页
设计特点: 进度条展示,步骤清晰,引导性强
-->
<div class="w-[1440px] h-[810px] bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative z-10 flex flex-col justify-center">
    <!-- 标题 -->
    <h2 class="text-4xl font-bold text-slate-900 mb-12 text-center">目录</h2>
    
    <!-- 章节列表 - 横向进度条 -->
    <div class="relative">
      <!-- 进度条背景 -->
      <div class="absolute top-10 left-0 right-0 h-2 bg-gray-300 rounded-full"></div>
      
      <div class="grid grid-cols-4 gap-4 relative">
        
        <div class="flex flex-col items-center">
          <!-- 节点 -->
          <div class="w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-xl border-4 border-white z-10 mb-5">
            1
          </div>
          <!-- 文字 -->
          <div class="bg-white p-3 rounded-lg shadow-lg text-center w-full hover:shadow-xl transition-all duration-300">
            <div class="text-base text-gray-800 font-semibold leading-tight">项目背景</div>
          </div>
        </div>
        
        <div class="flex flex-col items-center">
          <!-- 节点 -->
          <div class="w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-xl border-4 border-white z-10 mb-5">
            2
          </div>
          <!-- 文字 -->
          <div class="bg-white p-3 rounded-lg shadow-lg text-center w-full hover:shadow-xl transition-all duration-300">
            <div class="text-base text-gray-800 font-semibold leading-tight">核心功能</div>
          </div>
        </div>
        
        <div class="flex flex-col items-center">
          <!-- 节点 -->
          <div class="w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-xl border-4 border-white z-10 mb-5">
            3
          </div>
          <!-- 文字 -->
          <div class="bg-white p-3 rounded-lg shadow-lg text-center w-full hover:shadow-xl transition-all duration-300">
            <div class="text-base text-gray-800 font-semibold leading-tight">技术架构</div>
          </div>
        </div>
        
        <div class="flex flex-col items-center">
          <!-- 节点 -->
          <div class="w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-xl border-4 border-white z-10 mb-5">
            4
          </div>
          <!-- 文字 -->
          <div class="bg-white p-3 rounded-lg shadow-lg text-center w-full hover:shadow-xl transition-all duration-300">
            <div class="text-base text-gray-800 font-semibold leading-tight">实施计划</div>
          </div>
        </div>
        
      </div>
    </div>
  </div>
</div>
