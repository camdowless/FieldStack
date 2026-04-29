import { PrismaClient, ItemType, TeamRole } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding lead time defaults...')

  const defaults = [
    { itemType: ItemType.CABINETS_STANDARD, leadTimeWeeks: 8, label: 'Cabinets (standard stock)' },
    { itemType: ItemType.CABINETS_CUSTOM, leadTimeWeeks: 16, label: 'Cabinets (custom / semi-custom)' },
    { itemType: ItemType.COUNTERTOPS, leadTimeWeeks: 3, label: 'Countertops (after template)' },
    { itemType: ItemType.HARDWARE, leadTimeWeeks: 4, label: 'Hardware & specialties' },
  ]

  for (const d of defaults) {
    await prisma.leadTimeSetting.upsert({
      where: { itemType_projectId: { itemType: d.itemType, projectId: null as any } },
      update: { leadTimeWeeks: d.leadTimeWeeks, label: d.label },
      create: { ...d, isDefault: true },
    })
  }

  console.log('Seeding default team owner...')
  await prisma.teamMember.upsert({
    where: { email: 'owner@yourcompany.com' },
    update: {},
    create: {
      name: 'Owner',
      email: 'owner@yourcompany.com',
      role: TeamRole.OWNER,
      notifyOnCritical: true,
      notifyOnOrderReminder: true,
      notifyOnScheduleChange: true,
    }
  })

  console.log('✅ Seed complete')
}

main().catch(console.error).finally(() => prisma.$disconnect())
