/* One canonical status per resource; legacy labels remain readable on import. */
(function(root) {
  const lists = {
    audio:['未听','在听','已听','弃听'],
    game: ['未开始', '进行中', '已通关', '全成就', '已弃坑'],
    movie: ['未看', '在看', '已看', '弃看'], anime: ['未看', '在看', '已看', '弃番'],
    manga: ['未读', '在读', '已读', '弃读'], book: ['未读', '在读', '已读', '弃读'],
    software:['待使用','使用中','已完成','已停用'],document:['未读','在读','已读','弃读'],
    other: ['待整理', '进行中', '已完成', '已放弃']
  };
  function normalize(status, type = 'game') {
    const value = String(status || '').trim();
    const legacy = { '想看': '未看', '想读': '未读' };
    const canonical = legacy[value] || value || (lists[type] || lists.other)[0];
    return type === 'manga' ? ({ '未看': '未读', '在看': '在读', '已看': '已读', '弃漫': '弃读' }[canonical] || canonical) : canonical;
  }
  function phase(status) {
    if (status === '全成就') return 'mastered';
    if (['已听','已通关', '已看', '已读', '已完成'].includes(status)) return 'completed';
    if (['在听','进行中', '在看', '在读','使用中'].includes(status)) return 'active';
    if (['弃听','已弃坑', '弃看', '弃番', '弃漫', '弃读', '已放弃','已停用'].includes(status)) return 'dropped';
    return 'pending';
  }
  const stages = { pending: '尚未开始', active: '正在进行', completed: '已经完成', dropped: '已弃坑' };
  const stage = status => phase(status) === 'mastered' ? 'completed' : phase(status);
  const api = { lists, normalize, phase, stages, stage, completed: status => ['completed', 'mastered'].includes(phase(status)) };
  if (typeof module !== 'undefined') module.exports = api;
  if (root) root.StatusModel = api;
})(typeof window !== 'undefined' ? window : null);
