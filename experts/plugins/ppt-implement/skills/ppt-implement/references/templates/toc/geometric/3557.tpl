<!-- 
模板ID: 3557
模板名称: 几何风-网格交错
适用场景: 规整几何风目录页
设计特点: 网格系统,交错排列,秩序感
-->
<div class="w-[1440px] h-[810px] bg-gradient-to-br from-teal-100 to-green-100 relative overflow-hidden">
  <!-- 网格装饰 -->
  <div class="absolute inset-0 opacity-5">
    <div class="w-full h-full" style="background-image: linear-gradient(teal 2px, transparent 2px), linear-gradient(90deg, teal 2px, transparent 2px); background-size: 50px 50px;"></div>
  </div>
  
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col justify-center relative z-10">
    <!-- 标题 -->
    <h2 class="text-4xl font-bold text-teal-900 mb-10 text-center bg-white inline-block px-10 py-5 shadow-xl mx-auto block">目录</h2>
    
    <!-- 章节列表 - 交错网格 -->
    <div class="grid grid-cols-2 gap-5">
      
      <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 ">
        <div class="flex flex-col gap-3">
          <div class="w-14 h-14 bg-gradient-to-br from-teal-600 to-green-600 text-white flex items-center justify-center text-xl font-bold">
            1
          </div>
          <div class="text-lg text-gray-800 font-bold">项目背景</div>
        </div>
      </div>
      
      <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 ">
        <div class="flex flex-col gap-3">
          <div class="w-14 h-14 bg-gradient-to-br from-teal-600 to-green-600 text-white flex items-center justify-center text-xl font-bold">
            2
          </div>
          <div class="text-lg text-gray-800 font-bold">核心功能</div>
        </div>
      </div>
      
      <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 ">
        <div class="flex flex-col gap-3">
          <div class="w-14 h-14 bg-gradient-to-br from-teal-600 to-green-600 text-white flex items-center justify-center text-xl font-bold">
            3
          </div>
          <div class="text-lg text-gray-800 font-bold">技术架构</div>
        </div>
      </div>
      
      <div class="bg-white p-6 shadow-xl hover:shadow-2xl transition-all duration-300 ">
        <div class="flex flex-col gap-3">
          <div class="w-14 h-14 bg-gradient-to-br from-teal-600 to-green-600 text-white flex items-center justify-center text-xl font-bold">
            4
          </div>
          <div class="text-lg text-gray-800 font-bold">实施计划</div>
        </div>
      </div>
      
    </div>
  </div>
</div>
