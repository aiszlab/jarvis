import { rimraf } from 'rimraf'
import { globSync } from 'fs'
import inquirer from 'inquirer'

export type RemoveBy = {
  recursive?: boolean
}

type Options = {
  patterns: string
}

export const remove = async ({ recursive = false }: RemoveBy = {}) => {
  const { patterns } = await inquirer.prompt<Options>([
    {
      type: 'checkbox',
      name: 'patterns',
      message: 'Select preset removable modules',
      choices: [{ value: 'node_modules', name: 'node_modules' }],
      default: false
    }
  ])

  // recursive every folder
  const paths = recursive ? globSync(patterns) : [patterns]

  await Promise.all(
    paths.map(async (path) => {
      return await rimraf(path)
    })
  )
}
