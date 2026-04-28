# Changelog

## [0.2.0](https://github.com/SoroLabs/SoroTask/compare/soro_task_contract-v0.1.0...soro_task_contract-v0.2.0) (2026-04-28)


### Features

* Add Gas Consumption Tracking for Contract Operations ([#107](https://github.com/SoroLabs/SoroTask/issues/107)) ([932701e](https://github.com/SoroLabs/SoroTask/commit/932701e96ea071f4a9e0ea346b6d58ff35209bd5))
* Add Gas Consumption Tracking for Contract Operations ([#107](https://github.com/SoroLabs/SoroTask/issues/107)) ([bab4b1a](https://github.com/SoroLabs/SoroTask/commit/bab4b1aad9ff5070d7f9d1c11d5797a133bb03c5))
* add get-task-function ([ccf6429](https://github.com/SoroLabs/SoroTask/commit/ccf64295de6afabe9add1c9689deb0bc91bf70fe))
* add get-task-function ([6166c67](https://github.com/SoroLabs/SoroTask/commit/6166c67fdc15591498bfd6588f8e060b552cb1d6))
* add pause and resume functions ([81c7fd9](https://github.com/SoroLabs/SoroTask/commit/81c7fd93aecf90b1cda551bc17927e4083fc62fe))
* add resolver pattern ([f3109cf](https://github.com/SoroLabs/SoroTask/commit/f3109cf61d6ab80a709c7cadbe2e1f9556199709))
* add task dependency relationships ([3bcb59e](https://github.com/SoroLabs/SoroTask/commit/3bcb59eafb61cf50cfe69abd3747a5df57632745))
* add unit test suite ([fe5a6d9](https://github.com/SoroLabs/SoroTask/commit/fe5a6d905024f5e8ce0b6181f4de97f6a0e3f292))
* added update task list ([e0765e2](https://github.com/SoroLabs/SoroTask/commit/e0765e2724ee8383611ebbec95494deee81550e6))
* **contract:** add cargo-fuzz targets for register and execute ([#98](https://github.com/SoroLabs/SoroTask/issues/98)) ([3d95c35](https://github.com/SoroLabs/SoroTask/commit/3d95c35bddeda80ae81742bdafc43ce59d782212))
* **contract:** implement cargo-fuzz testing for register and execute ([#98](https://github.com/SoroLabs/SoroTask/issues/98)) ([3f7f222](https://github.com/SoroLabs/SoroTask/commit/3f7f2228c2dc8f8f7e7bddf769cb6d1d4003c226))
* Gas Management System ([4aa3465](https://github.com/SoroLabs/SoroTask/commit/4aa3465b0d7434bd369a446bf053166ca40a535d))
* Implement Contract Initialization and Migration Scripts ([#117](https://github.com/SoroLabs/SoroTask/issues/117)) ([1ac7644](https://github.com/SoroLabs/SoroTask/commit/1ac76445096906a3d75b99f38d00659d629400de))
* implement contract initialization, upgrade, and migration scripts ([949535a](https://github.com/SoroLabs/SoroTask/commit/949535a3fa546cb514f153a23bbf222d20da93fb))
* implement cross-contract task execution (closes [#4](https://github.com/SoroLabs/SoroTask/issues/4)) ([7053960](https://github.com/SoroLabs/SoroTask/commit/7053960e808cb0bc2800e23fc6e774acd2ea75f1))
* implement cross-contract task execution in execute fn ([c049bff](https://github.com/SoroLabs/SoroTask/commit/c049bff500262c98da828aa6243640c787ba01e9)), closes [#4](https://github.com/SoroLabs/SoroTask/issues/4)
* implement gas management system ([2bac41c](https://github.com/SoroLabs/SoroTask/commit/2bac41c3d47dbf88bf2798c875d057a56781dcc4))
* implement keeper reward & fee mechanism ([#5](https://github.com/SoroLabs/SoroTask/issues/5)) ([0e4f88c](https://github.com/SoroLabs/SoroTask/commit/0e4f88c220c11b9168066129397f231f548eddba))
* implement private tasks (whitelisted keepers) ([412fbe9](https://github.com/SoroLabs/SoroTask/commit/412fbe9b2c91028d1bb9e793dce304b7ecc976e8))
* implement private tasks (whitelisted keepers) ([62d0242](https://github.com/SoroLabs/SoroTask/commit/62d0242aa152f80ac4ef9f4516033c3035256a74))
* implement task monitoring function ([f359493](https://github.com/SoroLabs/SoroTask/commit/f3594939e8b74513afddbd6a20fe940ede0ae28a))
* implemented task registration logic ([af33543](https://github.com/SoroLabs/SoroTask/commit/af335437fd5591fd08c7ba26686cc14622184368))
* task registration logic ([7b7f84d](https://github.com/SoroLabs/SoroTask/commit/7b7f84d364949862010bca91e5f209ae371d7401))
* **testing:** implement code coverage reporting with Codecov ([61cf687](https://github.com/SoroLabs/SoroTask/commit/61cf687806ae2e62e6713c14c3b66bfcf5a44b2a)), closes [#114](https://github.com/SoroLabs/SoroTask/issues/114)
* tests gas management lifecycle ([7ea837e](https://github.com/SoroLabs/SoroTask/commit/7ea837ebc07dad5559b0adb694e568f7086ca904))


### Bug Fixes

* **contract:** enforce interval check in execute function ([66da670](https://github.com/SoroLabs/SoroTask/commit/66da670ad6d947ce86b8103c8a3b315fdb95f105))
* **pr-24:** remove build artifacts and add tests ([fdbc798](https://github.com/SoroLabs/SoroTask/commit/fdbc7986106683fb50f63f89045c38fda2702e8e))
* replace outdated functions ([a0c5eee](https://github.com/SoroLabs/SoroTask/commit/a0c5eee6a78504d1c7cd238f02c8113ebcdea51d))
* resolve conflicts ([1f07db5](https://github.com/SoroLabs/SoroTask/commit/1f07db57f0a7f56d9ec755f9c752e2f703de6828))
* Update contract tests to work with soroban-sdk v25.3.0 ([3228785](https://github.com/SoroLabs/SoroTask/commit/32287859861cc6ab927aafc92a9f6a5efd8661ee))


### Performance Improvements

* **contract:** add active task index for monitor and paginated scans ([0b410db](https://github.com/SoroLabs/SoroTask/commit/0b410dbe83c9ce49968968b5a67ecf2ab8b747f2))
