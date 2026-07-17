<!-- 
模板ID: 3551
模板名称: 几何风-菱形网格
适用场景: 现代几何风目录页
设计特点: 菱形造型,网格排列,几何美感
-->
<div class="w-[1440px] h-[810px] bg-gradient-to-br from-purple-100 via-pink-100 to-orange-100 relative overflow-hidden">
  <!-- 背景几何装饰 -->
  <div class="absolute inset-0 opacity-10">
    <div class="absolute top-10 left-10 w-32 h-32 border-4 border-purple-500 transform rotate-45"></div>
    <div class="absolute bottom-20 right-20 w-40 h-40 border-4 border-orange-500 transform rotate-45"></div>
  </div>
  
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col justify-center relative z-10">
    <!-- 标题 -->
    <h2 class="text-4xl font-bold text-purple-900 mb-10 text-center">目录</h2>
    
    <!-- 章节列表 - 菱形卡片 -->
    <div class="grid grid-cols-2 gap-8">
      
      <div class="relative group">
        <div class="bg-white p-6 transform rotate-2 hover:rotate-0 transition-all duration-300 shadow-xl hover:shadow-2xl">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-600 text-white transform rotate-45 flex items-center justify-center flex-shrink-0 shadow-lg">
              <span class="transform -rotate-45 text-xl font-bold">1</span>
            </div>
            <div class="text-xl text-gray-800 font-bold">项目背景</div>
          </div>
        </div>
      </div>
      
      <div class="relative group">
        <div class="bg-white p-6 transform rotate-2 hover:rotate-0 transition-all duration-300 shadow-xl hover:shadow-2xl">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-600 text-white transform rotate-45 flex items-center justify-center flex-shrink-0 shadow-lg">
              <span class="transform -rotate-45 text-xl font-bold">2</span>
            </div>
            <div class="text-xl text-gray-800 font-bold">核心功能</div>
          </div>
        </div>
      </div>
      
      <div class="relative group">
        <div class="bg-white p-6 transform rotate-2 hover:rotate-0 transition-all duration-300 shadow-xl hover:shadow-2xl">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-600 text-white transform rotate-45 flex items-center justify-center flex-shrink-0 shadow-lg">
              <span class="transform -rotate-45 text-xl font-bold">3</span>
            </div>
            <div class="text-xl text-gray-800 font-bold">技术架构</div>
          </div>
        </div>
      </div>
      
      <div class="relative group">
        <div class="bg-white p-6 transform rotate-2 hover:rotate-0 transition-all duration-300 shadow-xl hover:shadow-2xl">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-600 text-white transform rotate-45 flex items-center justify-center flex-shrink-0 shadow-lg">
              <span class="transform -rotate-45 text-xl font-bold">4</span>
            </div>
            <div class="text-xl text-gray-800 font-bold">实施计划</div>
          </div>
        </div>
      </div>
      
    </div>
  </div>
</div>
