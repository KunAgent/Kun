<!-- 
模板ID: 3537
模板名称: 卡通风-彩虹桥
适用场景: 色彩丰富的儿童目录页
设计特点: 彩虹渐变,拱桥造型,多彩活泼
-->
<div class="w-[1440px] h-[810px] bg-gradient-to-b from-sky-200 via-sky-100 to-white flex items-center justify-center relative overflow-hidden">
  <!-- 彩虹拱桥 -->
  <div class="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-b-full" style="background: linear-gradient(180deg, #ef4444 0%, #ef4444 14%, #f97316 14%, #f97316 28%, #eab308 28%, #eab308 42%, #22c55e 42%, #22c55e 57%, #3b82f6 57%, #3b82f6 71%, #8b5cf6 71%, #8b5cf6 85%, #ec4899 85%, #ec4899 100%); opacity: 0.3;"></div>
  
  <!-- 云朵装饰 -->
  <div class="absolute top-16 left-20 flex gap-1">
    <div class="w-12 h-8 bg-white rounded-full"></div>
    <div class="w-16 h-12 bg-white rounded-full -ml-4 -mt-2"></div>
    <div class="w-10 h-8 bg-white rounded-full -ml-3"></div>
  </div>
  <div class="absolute top-24 right-32 flex gap-1">
    <div class="w-10 h-6 bg-white rounded-full"></div>
    <div class="w-14 h-10 bg-white rounded-full -ml-3 -mt-2"></div>
    <div class="w-8 h-6 bg-white rounded-full -ml-2"></div>
  </div>
  
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative z-10 flex flex-col justify-center">
    <!-- 标题 -->
    <h2 class="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 mb-12 text-center">目录</h2>
    
    <!-- 章节列表 - 彩虹色卡片 -->
    <div class="grid grid-cols-2 gap-6">
      
      <div class="bg-white/80 backdrop-blur p-6 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 border-4 border-red-300">
        <div class="flex items-center gap-5">
          <div class="w-14 h-14 bg-gradient-to-br from-red-400 to-orange-400 text-white rounded-2xl flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-md">
            1
          </div>
          <div class="text-xl text-gray-700 font-bold">项目背景</div>
        </div>
      </div>
      
      <div class="bg-white/80 backdrop-blur p-6 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 border-4 border-yellow-300">
        <div class="flex items-center gap-5">
          <div class="w-14 h-14 bg-gradient-to-br from-yellow-400 to-green-400 text-white rounded-2xl flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-md">
            2
          </div>
          <div class="text-xl text-gray-700 font-bold">核心功能</div>
        </div>
      </div>
      
      <div class="bg-white/80 backdrop-blur p-6 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 border-4 border-green-300">
        <div class="flex items-center gap-5">
          <div class="w-14 h-14 bg-gradient-to-br from-green-400 to-blue-400 text-white rounded-2xl flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-md">
            3
          </div>
          <div class="text-xl text-gray-700 font-bold">技术架构</div>
        </div>
      </div>
      
      <div class="bg-white/80 backdrop-blur p-6 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 border-4 border-purple-300">
        <div class="flex items-center gap-5">
          <div class="w-14 h-14 bg-gradient-to-br from-blue-400 to-purple-400 text-white rounded-2xl flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-md">
            4
          </div>
          <div class="text-xl text-gray-700 font-bold">实施计划</div>
        </div>
      </div>
      
    </div>
  </div>
</div>
