<!-- 
模板ID: 3558
模板名称: 几何风-星形爆炸
适用场景: 炫酷几何风目录页
设计特点: 放射状,爆发力,视觉冲击
-->
<div class="w-[1440px] h-[810px] bg-gradient-to-br from-yellow-100 via-orange-100 to-red-100 relative overflow-hidden">
  <!-- 放射线装饰 -->
  <div class="absolute inset-0 flex items-center justify-center opacity-10">
    <div class="w-1 h-full bg-orange-500 transform rotate-0"></div>
    <div class="absolute w-1 h-full bg-orange-500 transform rotate-45"></div>
    <div class="absolute w-full h-1 bg-orange-500 transform rotate-0"></div>
    <div class="absolute w-full h-1 bg-orange-500 transform rotate-45"></div>
  </div>
  
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col justify-center relative z-10">
    <!-- 标题 -->
    <div class="text-center mb-10">
      <h2 class="text-4xl font-bold text-orange-900 inline-block bg-white px-10 py-5 shadow-2xl transform rotate-2">目录</h2>
    </div>
    
    <!-- 章节列表 - 星形排列 -->
    <div class="grid grid-cols-2 gap-6">
      
      <div class="relative group">
        <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-110 transform  hover:rotate-0">
          <div class="flex items-center gap-5">
            <div class="w-20 h-20 bg-gradient-to-br from-yellow-500 via-orange-500 to-red-500 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg clip-star">
              1
            </div>
            <div class="text-lg text-gray-800 font-bold">项目背景</div>
          </div>
        </div>
      </div>
      
      <div class="relative group">
        <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-110 transform  hover:rotate-0">
          <div class="flex items-center gap-5">
            <div class="w-20 h-20 bg-gradient-to-br from-yellow-500 via-orange-500 to-red-500 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg clip-star">
              2
            </div>
            <div class="text-lg text-gray-800 font-bold">核心功能</div>
          </div>
        </div>
      </div>
      
      <div class="relative group">
        <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-110 transform  hover:rotate-0">
          <div class="flex items-center gap-5">
            <div class="w-20 h-20 bg-gradient-to-br from-yellow-500 via-orange-500 to-red-500 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg clip-star">
              3
            </div>
            <div class="text-lg text-gray-800 font-bold">技术架构</div>
          </div>
        </div>
      </div>
      
      <div class="relative group">
        <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-110 transform  hover:rotate-0">
          <div class="flex items-center gap-5">
            <div class="w-20 h-20 bg-gradient-to-br from-yellow-500 via-orange-500 to-red-500 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-lg clip-star">
              4
            </div>
            <div class="text-lg text-gray-800 font-bold">实施计划</div>
          </div>
        </div>
      </div>
      
    </div>
  </div>
</div>
